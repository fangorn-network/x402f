import {
    createWalletClient,
    createPublicClient,
    http,
    keccak256,
    stringToBytes,
    bytesToString,
    type Hex,
    type Address,
    parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { encryptAndUpload, downloadAndDecrypt } from "./settle.js";

const getEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`Environment variable ${key} is not set`);
    return value;
};

// Split write/read ABIs — keeps viem's readContract overload from folding in
// call params (authorizationList/stateOverride) off a mixed abi.
const REGISTRY_WRITE_ABI = [
    {
        inputs: [
            { name: "resource_id", type: "bytes32" },
            { name: "price", type: "uint256" },
            { name: "uri", type: "string" },
        ],
        name: "createResource",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
    },
] as const;

const REGISTRY_READ_ABI = parseAbi([
    'function getUri(bytes32 resource_id) view returns (string)'
]);

// uri packs both the worker to fetch from and the plaintext hash to verify
// against: `${workerUrl}#${plaintextHash}`.
const packUri = (workerUrl: string, plaintextHash: Hex) => `${workerUrl}#${plaintextHash}`;
const unpackUri = (uri: string): { workerUrl: string; plaintextHash: Hex } => {
    const [workerUrl, plaintextHash] = uri.split("#");
    return { workerUrl, plaintextHash: plaintextHash as Hex };
};

async function main() {
    const privateKey = getEnv("EVM_PRIVATE_KEY") as Hex;
    const workerUrl = getEnv("WORKER_URL").replace(/\/$/, "");
    const registry = getEnv("SETTLEMENT_REGISTRY_ADDR") as Address;
    const rpcUrl = process.env.VITE_CHAIN_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpcUrl) });
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });

    // ── The data + its resource id ────────────────────────────────────────────
    const name = `demo-episode-${Date.now()}`; // unique so create_resource won't collide
    const plaintext = stringToBytes("Hello Fangorn! This is my (encrypted) episode.");
    const resourceId = keccak256(stringToBytes(name)); // bytes32

    console.log("resourceId:", resourceId);
    console.log("owner     :", account.address);

    // ── SELL: encrypt → upload {ct, sealed DEK} → commit on-chain ─────────────
    const { plaintextHash, ciphertextHash } = await encryptAndUpload({ plaintext, resourceId, workerUrl });
    console.log("uploaded  : plaintextHash", plaintextHash, "ciphertextHash", ciphertextHash);

    const hash = await walletClient.writeContract({
        address: registry,
        abi: REGISTRY_WRITE_ABI,
        functionName: "createResource",
        args: [resourceId, 0n, packUri(workerUrl, plaintextHash)], // price 0 → free (no facilitator needed)
        account,
        chain: arbitrumSepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("committed : createResource tx", hash);

    // ── BUY (from myself): read the on-chain pointer, download, decrypt, verify ─
    const uri = await publicClient.readContract({
        address: registry,
        abi: REGISTRY_READ_ABI,
        functionName: "getUri",
        args: [resourceId as Hex],
        authorizationList: undefined,
    } as any);
    const resolved = unpackUri(uri as string);
    console.log("on-chain  : uri", uri);

    const recovered = await downloadAndDecrypt({
        resourceId,
        workerUrl: resolved.workerUrl,
        signer: account,
        expectedPlaintextHash: resolved.plaintextHash,
    });

    console.log("decrypted :", bytesToString(recovered));
    if (bytesToString(recovered) !== bytesToString(plaintext)) throw new Error("roundtrip mismatch");
    console.log("✓ roundtrip verified (hash matched on-chain commitment)");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

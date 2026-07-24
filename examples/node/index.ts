import {
    createWalletClient,
    createPublicClient,
    http,
    keccak256,
    stringToBytes,
    bytesToString,
    toHex,
    type Hex,
    type Address,
    type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { encryptAndUpload, downloadAndDecrypt } from "./settle.js";
import { deriveBuyer, signTransferAuth, buildSettleProof } from "./paid.js";

const getEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`Environment variable ${key} is not set`);
    return value;
};

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

// uri packs both the worker to fetch from and the plaintext hash to verify
// against: `${workerUrl}#${plaintextHash}`.
const packUri = (workerUrl: string, plaintextHash: Hex) => `${workerUrl}#${plaintextHash}`;
const unpackUri = (uri: string): { workerUrl: string; plaintextHash: Hex } => {
    const [workerUrl, plaintextHash] = uri.split("#");
    return { workerUrl, plaintextHash: plaintextHash as Hex };
};

async function postExtra(baseUrl: string, path: string, extra: object) {
    const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
            {
                paymentPayload: { x402Version: 2 },
                paymentRequirements: {
                    scheme: "exact",
                    network: `eip155:${arbitrumSepolia.id}`,
                    extra,
                },
            },
            (_, v) => (typeof v === "bigint" ? v.toString() : v),
        ),
    });
    return res.json();
}

async function main() {
    const ownerKey = getEnv("EVM_PRIVATE_KEY") as Hex;
    const buyerKey = getEnv("BUYER_PRIVATE_KEY") as Hex;
    const workerUrl = getEnv("WORKER_URL").replace(/\/$/, "");
    const registry = getEnv("SETTLEMENT_REGISTRY_ADDR") as Address;
    const usdcAddress = getEnv("USDC_CONTRACT_ADDR") as Address;
    const usdcDomainName = process.env.USDC_DOMAIN_NAME ?? "USD Coin";
    const facilitatorUrl = (process.env.FACILITATOR_URL ?? "http://localhost:30333").replace(/\/$/, "");
    const price = BigInt(process.env.RESOURCE_PRICE ?? "1000"); // USDC base units (6 decimals)
    const rpcUrl = process.env.VITE_CHAIN_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";

    const owner = privateKeyToAccount(ownerKey);
    const ownerWallet = createWalletClient({ account: owner, chain: arbitrumSepolia, transport: http(rpcUrl) });
    const buyer = privateKeyToAccount(buyerKey);
    const buyerWallet = createWalletClient({ account: buyer, chain: arbitrumSepolia, transport: http(rpcUrl) });
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) }) as PublicClient;

    const name = `demo-episode-${Date.now()}`; // unique so createResource won't collide
    const plaintext = stringToBytes("Hello Fangorn! This is my (encrypted, paid) episode.");
    const resourceId = keccak256(stringToBytes(name)); // bytes32

    console.log("resourceId:", resourceId);
    console.log("owner     :", owner.address);
    console.log("buyer     :", buyer.address);
    console.log("price     :", price.toString(), "USDC base units");

    // ── SELL: encrypt → upload {ct, sealed DEK} → createResource(price>0) ──────
    const { plaintextHash } = await encryptAndUpload({ plaintext, resourceId, workerUrl });
    const createHash = await ownerWallet.writeContract({
        address: registry,
        abi: REGISTRY_WRITE_ABI,
        functionName: "createResource",
        args: [resourceId, price, packUri(workerUrl, plaintextHash)],
        account: owner,
        chain: arbitrumSepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash: createHash });
    console.log("committed : createResource tx", createHash);

    // ── BUY: register (pay owner + join group) then settle (prove membership) ──
    const { identity, stealthKey, stealthAddress } = await deriveBuyer(buyerWallet);

    // Buyer signs an EIP-3009 authorization paying the owner the exact price.
    const payment = await signTransferAuth(buyerWallet, {
        to: owner.address,
        amount: price,
        usdcAddress,
        usdcDomainName,
        usdcDomainVersion: "2",
    });

    const verify = await postExtra(facilitatorUrl, "/verify", {
        resourceId,
        identityCommitment: identity.commitment.toString(),
        payment,
    });
    if (!verify.isValid) throw new Error(`verify (register) failed: ${verify.invalidReason}`);
    console.log("registered: identity joined the group, owner paid");

    const proof = await buildSettleProof({ publicClient, registry, identity, resourceId, stealthAddress });
    const settle = await postExtra(facilitatorUrl, "/settle", proof);
    if (!settle.success) throw new Error(`settle (claim) failed: ${settle.errorReason}`);
    const nullifier: string = settle.extensions.nullifier;
    console.log("settled   : tx", settle.transaction, "nullifier", nullifier);

    // ── ACCESS: download + decrypt, signing with the stealth key so the worker
    // recovers the settled address and releases the DEK ───────────────────────
    const uri = await publicClient.readContract({
        address: registry,
        abi: [{ name: "getUri", type: "function", stateMutability: "view", inputs: [{ name: "resource_id", type: "bytes32" }], outputs: [{ type: "string" }] }] as const,
        functionName: "getUri",
        args: [resourceId],
    });
    const resolved = unpackUri(uri as string);

    const recovered = await downloadAndDecrypt({
        resourceId,
        workerUrl: resolved.workerUrl,
        signer: privateKeyToAccount(stealthKey),
        nullifier: toHex(BigInt(nullifier)),
        expectedPlaintextHash: resolved.plaintextHash,
    });

    console.log("decrypted :", bytesToString(recovered));
    if (bytesToString(recovered) !== bytesToString(plaintext)) throw new Error("roundtrip mismatch");
    console.log("✓ paid roundtrip verified (register → settle → gated decrypt)");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

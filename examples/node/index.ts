// Sells one piece of encrypted content and buys it back through the x402f
// facilitator — the whole private-payment loop in one script.
//
// The buy side is the `@fangorn-network/fetch` middleware; everything left here
// is the SELLER's job (encrypt, upload, list on-chain), which no buyer library
// should be doing.
//
// Deployment details come from the SDK, not this file: `FangornConfig` carries
// the chain, the RPC and the SettlementRegistry address, and the registry itself
// is asked for its USDC. An .env that names a registry can name a stale one —
// this is the same object the SDK, the CLI and the facilitator all read.

import { bytesToString, keccak256, stringToBytes, type Address, type Hex, type PublicClient } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { FangornX402Middleware } from "@fangorn-network/fetch";
import {
    FangornConfig,
    SettlementRegistryClient,
    packResourceUri,
    resourceIdOf,
} from "@fangorn-network/sdk";
import { encryptAndUpload } from "./publish.js";

const getEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`Environment variable ${key} is not set`);
    return value;
};

async function main() {
    const ownerKey = getEnv("EVM_PRIVATE_KEY") as Hex;
    const buyerKey = getEnv("BUYER_PRIVATE_KEY") as Hex;

    // run `wrangler dev --local` under /webworkers/fangorn-access-worker
    const workerUrl = getEnv("WORKER_URL").replace(/\/$/, "");
    const uploadToken = getEnv("WORKER_UPLOAD_TOKEN");
    const facilitatorUrl = process.env.FACILITATOR_URL ?? "http://localhost:30333";
    const price = BigInt(process.env.RESOURCE_PRICE ?? "1000"); // USDC base units (6 decimals)

    // Scalars only from the config. The SDK is installed as a `link:`, so it
    // resolves viem out of its own node_modules — a second copy of the same
    // version that TypeScript compares nominally, which makes FangornConfig.chain
    // "not assignable" to the identical local Chain. Take the chain locally and
    // assert it is the one the config describes.
    const chain = arbitrumSepolia;
    if (chain.id !== FangornConfig.caip2) {
        throw new Error(`SDK config targets chain ${FangornConfig.caip2}, this example builds for ${chain.id}`);
    }
    const rpcUrl = process.env.VITE_CHAIN_RPC_URL ?? FangornConfig.rpcUrl;
    const registryAddress = (process.env.SETTLEMENT_REGISTRY_ADDR ??
        FangornConfig.settlementRegistryContractAddress) as Address;

    const owner = privateKeyToAccount(ownerKey);
    const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
    const buyer = privateKeyToAccount(buyerKey);
    const buyerWallet = createWalletClient({ account: buyer, chain, transport: http(rpcUrl) });
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;

    // The SDK's publisher-side client for the settlement rail. The buyer half
    // (Semaphore identity, EIP-3009 signature, membership proof) is the fetch
    // package's job and deliberately not here.
    // Same two-copies-of-viem story as the chain above: structurally identical
    // at runtime, nominally distinct to tsc.
    const settlement = new SettlementRegistryClient(
        registryAddress,
        publicClient as never,
        ownerWallet as never,
    );

    // The registry names its own settlement token, so there is nothing to keep
    // in sync: a wrong USDC address in an .env is a signature that verifies
    // against the wrong domain and a transfer that never happens.
    const usdcAddress = await settlement.getUsdc();

    const name = `demo-episode-${Date.now()}`; // unique so createResource won't collide
    const plaintext = stringToBytes("Hello Fangorn! This is my (encrypted, paid) episode.");
    const uid = keccak256(stringToBytes(name)); // bytes32, the publisher's own id
    const resourceId = resourceIdOf(owner.address, uid);

    console.log("registry  :", registryAddress);
    console.log("usdc      :", usdcAddress);
    console.log("resourceId:", resourceId);
    console.log("owner     :", owner.address);
    console.log("buyer     :", buyer.address);
    console.log("price     :", price.toString(), "USDC base units");

    // ── SELL: encrypt → upload {ct, sealed DEK} → createResource ──────────────
    const { plaintextHash } = await encryptAndUpload({ plaintext, resourceId, workerUrl, uploadToken });
    const createHash = await settlement.createResource(uid, price, packResourceUri(workerUrl, plaintextHash));
    console.log("committed : createResource tx", createHash);

    // Derived locally above; the registry derives the same id from (owner, uid).
    // If these ever disagree the buyer pays for one resource and reads another.
    const onChainId = await settlement.resourceIdFor(owner.address, uid);
    if (onChainId !== resourceId) throw new Error(`resourceId mismatch: ${resourceId} vs ${onChainId}`);

    // ── BUY: register → settle → gated decrypt, all inside fetchResource ──────
    const middleware = await FangornX402Middleware.create({
        walletClient: buyerWallet,
        chain,
        rpcUrl,
        registryAddress,
        usdcAddress,
        usdcDomainName: process.env.USDC_DOMAIN_NAME ?? "USD Coin",
        facilitatorUrl,
    });
    console.log("stealth   :", middleware.stealthAddress);

    const result = await middleware.fetchResource({ publisher: owner.address, uid });
    if (!result.success) throw new Error(result.error);
    console.log("settled   : nullifier", result.nullifier, result.alreadySettled ? "(already settled)" : "");

    console.log("decrypted :", bytesToString(result.data!));
    if (bytesToString(result.data!) !== bytesToString(plaintext)) throw new Error("roundtrip mismatch");

    // A second fetch must NOT pay again: the settlement is on-chain and the
    // nullifier is recomputable, so this exercises the already-settled path.
    const again = await middleware.fetchResource({ resourceId });
    if (!again.success) throw new Error(`repeat fetch failed: ${again.error}`);
    if (!again.alreadySettled) throw new Error("repeat fetch paid again — already-settled path is broken");
    if (again.nullifier !== result.nullifier) throw new Error("recomputed nullifier does not match the proof's");

    console.log("✓ paid roundtrip verified (register → settle → gated decrypt, then cached)");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

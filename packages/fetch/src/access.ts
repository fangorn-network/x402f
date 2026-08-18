// Settlement-gated retrieval from the access worker.
//
// Envelope model: the publisher AES-256-GCM'd the data under a random DEK,
// uploaded the ciphertext to the worker's bucket, and sealed the DEK to the
// worker's X25519 pubkey. The worker never sees plaintext — it unseals the
// 32-byte DEK only for an address the registry says has settled.
//
// Bulk layout in the bucket:  nonce(12) || aes-256-gcm(ct||tag)

import { bytesToHex, encodePacked, hexToBytes, keccak256, type Hex } from "viem";

const NONCE_LEN = 12;

/** Anything that can personal_sign a raw 32-byte hash (e.g. a viem LocalAccount). */
export interface AccessSigner {
    address: Hex;
    signMessage(args: { message: { raw: Hex } }): Promise<Hex>;
}

/** SHA-256 as the worker and the SDK both format it: 0x + hex of the digest. */
export const sha256Hex = async (bytes: Uint8Array): Promise<Hex> =>
    bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));

/**
 * The message the worker recovers the settling address from — must match
 * `buildMessageHash` in the worker byte-for-byte:
 *   keccak256(abi.encodePacked(uint256 nullifier, bytes32 resourceId, uint64 timestamp))
 */
export const accessMessageHash = (nullifier: Hex, resourceId: Hex, timestamp: number): Hex =>
    keccak256(encodePacked(["uint256", "bytes32", "uint64"], [BigInt(nullifier), resourceId, BigInt(timestamp)]));

/** The on-chain uri packs the worker to fetch from and the plaintext hash to
 *  verify against: `${workerUrl}#${plaintextHash}`. */
export function unpackUri(uri: string): { workerUrl: string; plaintextHash?: Hex } {
    const [workerUrl, plaintextHash] = uri.split("#");
    return { workerUrl: workerUrl.replace(/\/$/, ""), plaintextHash: plaintextHash as Hex | undefined };
}

/**
 * Download + decrypt. Signs an /access request — the address recovered from that
 * signature is the one the worker checks settlement for, so it must be signed
 * with the STEALTH key, not the buyer's wallet.
 *
 * `expectedPlaintextHash` (from the on-chain uri) is what makes this more than a
 * download: without it a worker could serve any bytes that decrypt.
 */
export async function downloadAndDecrypt(params: {
    resourceId: Hex;
    workerUrl: string;
    signer: AccessSigner;
    /** Per-read nullifier; any U256 for a free resource. */
    nullifier?: Hex;
    expectedPlaintextHash?: Hex;
}): Promise<Uint8Array> {
    const { resourceId, workerUrl, signer } = params;
    const nullifier = params.nullifier ?? bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signer.signMessage({
        message: { raw: accessMessageHash(nullifier, resourceId, timestamp) },
    });

    const accessRes = await fetch(`${workerUrl}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nullifier, resourceId, timestamp, signature }),
    });
    if (!accessRes.ok) throw new Error(`/access failed: ${accessRes.status} ${await accessRes.text()}`);
    const { dek } = (await accessRes.json()) as { dek: Hex };

    const ctRes = await fetch(`${workerUrl}/ct/${resourceId}`);
    if (!ctRes.ok) throw new Error(`/ct failed: ${ctRes.status}`);
    const ciphertext = new Uint8Array(await ctRes.arrayBuffer());

    const aesKey = await crypto.subtle.importKey("raw", hexToBytes(dek) as BufferSource, "AES-GCM", false, ["decrypt"]);
    const plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ciphertext.slice(0, NONCE_LEN) as BufferSource },
            aesKey,
            ciphertext.slice(NONCE_LEN) as BufferSource,
        ),
    );

    if (params.expectedPlaintextHash && (await sha256Hex(plaintext)) !== params.expectedPlaintextHash) {
        throw new Error("plaintext hash mismatch — got the wrong data back");
    }
    return plaintext;
}

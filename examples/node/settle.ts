// Client-side settlement crypto for the envelope model. Lives in the example
// repo, not the SDK — it only composes SDK-exposed primitives (`seal`,
// `sha256Hex`) plus WebCrypto for the bulk symmetric layer.
//
// Envelope: data is AES-256-GCM'd under a random 32-byte DEK. The big
// ciphertext goes to R2 (keyed by resourceId); the DEK is sealed to the access
// worker's X25519 pubkey and stored alongside it. The worker never sees
// plaintext and never decrypts the bulk data — it only unseals the 32-byte DEK
// after a settlement check.
//
// Bulk layout in R2:  nonce(12) || aes-256-gcm(ct||tag)

import { seal, sha256Hex } from "@fangorn-network/sdk";
import { bytesToHex, hexToBytes, keccak256, encodePacked, type Hex } from "viem";

const NONCE_LEN = 12;

/** Anything that can personal_sign a raw 32-byte hash (viem LocalAccount). */
export interface AccessSigner {
	address: Hex;
	signMessage(args: { message: { raw: Hex } }): Promise<Hex>;
}

async function importAesKey(dek: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", dek as BufferSource, "AES-GCM", false, [usage]);
}

/** GET the worker's static X25519 pubkey (what DEKs are sealed to). */
export async function getWorkerPubkey(workerUrl: string): Promise<Uint8Array> {
	const res = await fetch(`${workerUrl}/pubkey`);
	if (!res.ok) throw new Error(`/pubkey failed: ${res.status}`);
	const { pubkey } = (await res.json()) as { pubkey: Hex };
	return hexToBytes(pubkey);
}

/**
 * Envelope-encrypt `plaintext` and upload {ciphertext, sealed DEK} to the
 * access worker's R2. Returns the hashes to commit on-chain / verify against.
 */
export async function encryptAndUpload(params: {
	plaintext: Uint8Array;
	resourceId: Hex;
	workerUrl: string;
}): Promise<{ ciphertextHash: Hex; plaintextHash: Hex }> {
	const { plaintext, resourceId, workerUrl } = params;

	const dek = crypto.getRandomValues(new Uint8Array(32));
	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
	const aesKey = await importAesKey(dek, "encrypt");
	const aesCt = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, plaintext as BufferSource),
	);

	const ciphertext = new Uint8Array(NONCE_LEN + aesCt.length);
	ciphertext.set(nonce, 0);
	ciphertext.set(aesCt, NONCE_LEN);

	const sealedDek = seal(dek, await getWorkerPubkey(workerUrl), resourceId);

	const res = await fetch(`${workerUrl}/upload/${resourceId}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/octet-stream",
			"X-Sealed-Dek": bytesToHex(sealedDek),
		},
		body: ciphertext as unknown as BodyInit,
	});
	if (!res.ok) throw new Error(`/upload failed: ${res.status} ${await res.text()}`);

	return { ciphertextHash: sha256Hex(ciphertext), plaintextHash: sha256Hex(plaintext) };
}

/**
 * The message the worker recovers the settling address from — must match
 * `buildMessageHash` in the worker byte-for-byte:
 *   keccak256(abi.encodePacked(uint256 nullifier, bytes32 resourceId, uint64 timestamp))
 */
function accessMessageHash(nullifier: Hex, resourceId: Hex, timestamp: number): Hex {
	return keccak256(
		encodePacked(["uint256", "bytes32", "uint64"], [BigInt(nullifier), resourceId, BigInt(timestamp)]),
	);
}

/**
 * Settlement-gated download + decrypt. Signs an /access request (its address is
 * what the worker checks settlement for), gets the unsealed DEK, streams the
 * ciphertext from the worker, and decrypts locally. If `expectedPlaintextHash`
 * is given (e.g. read from the on-chain resource uri), verifies the result.
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

	const nonce = ciphertext.slice(0, NONCE_LEN);
	const aesCt = ciphertext.slice(NONCE_LEN);
	const aesKey = await importAesKey(hexToBytes(dek), "decrypt");
	const plaintext = new Uint8Array(
		await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, aesCt as BufferSource),
	);

	if (params.expectedPlaintextHash && sha256Hex(plaintext) !== params.expectedPlaintextHash) {
		throw new Error("plaintext hash mismatch — got the wrong data back");
	}
	return plaintext;
}

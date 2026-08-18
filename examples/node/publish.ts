// Seller-side envelope crypto. The buyer's half of this lives in
// `@fangorn-network/fetch`; publishing stays here because it needs the
// publisher's storage credentials and the SDK's sealing primitives.
//
// Envelope: data is AES-256-GCM'd under a random 32-byte DEK. The big
// ciphertext goes to the worker's bucket (keyed by resourceId); the DEK is
// sealed to the access worker's X25519 pubkey and stored alongside it. The
// worker never sees plaintext and never decrypts the bulk data — it only
// unseals the 32-byte DEK after a settlement check.
//
// Bulk layout:  nonce(12) || aes-256-gcm(ct||tag)

import { seal, sha256Hex } from "@fangorn-network/sdk";
import { bytesToHex, hexToBytes, type Hex } from "viem";

const NONCE_LEN = 12;

/** GET the worker's static X25519 pubkey (what DEKs are sealed to). */
export async function getWorkerPubkey(workerUrl: string): Promise<Uint8Array> {
	const res = await fetch(`${workerUrl}/pubkey`);
	if (!res.ok) throw new Error(`/pubkey failed: ${res.status}`);
	const { pubkey } = (await res.json()) as { pubkey: Hex };
	return hexToBytes(pubkey);
}

/**
 * Envelope-encrypt `plaintext` and upload {ciphertext, sealed DEK} to the
 * access worker. Returns the hashes to commit on-chain / verify against.
 */
export async function encryptAndUpload(params: {
	plaintext: Uint8Array;
	resourceId: Hex;
	workerUrl: string;
	/** The worker's upload token. A fresh bucket is claimed by whatever token
	 *  uploads first; a claimed one rejects anything else with 401. */
	uploadToken: string;
}): Promise<{ ciphertextHash: Hex; plaintextHash: Hex }> {
	const { plaintext, resourceId, workerUrl, uploadToken } = params;

	const dek = crypto.getRandomValues(new Uint8Array(32));
	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
	const aesKey = await crypto.subtle.importKey("raw", dek as BufferSource, "AES-GCM", false, ["encrypt"]);
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
			Authorization: `Bearer ${uploadToken}`,
		},
		body: ciphertext as unknown as BodyInit,
	});
	if (!res.ok) throw new Error(`/upload failed: ${res.status} ${await res.text()}`);

	return { ciphertextHash: sha256Hex(ciphertext), plaintextHash: sha256Hex(plaintext) };
}

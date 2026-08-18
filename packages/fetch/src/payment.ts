// Buyer-side payloads for the x402f facilitator. Nothing here touches the chain
// directly: the facilitator relays `register` and `settle` and pays the gas, so
// the buyer's stealth identity stays unfunded and unlinkable.
//
//   /verify → register : an EIP-3009 authorization + identity commitment
//   /settle → claim    : a Semaphore membership proof over the resource's group

import {
    concat,
    encodeAbiParameters,
    encodePacked,
    keccak256,
    parseSignature,
    toBytes,
    toHex,
    type Address,
    type Chain,
    type Hex,
    type PublicClient,
    type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import { poseidon2 } from "poseidon-lite";
import type { Erc3009Payment, SettleProof } from "./types.js";

/** `register()` adds the buyer to THIS resource's own Semaphore group and emits
 *  this event with resourceId indexed. Since v2 each resource has its own group,
 *  so a proof is built from only that resource's members. */
const MEMBER_REGISTERED_EVENT = {
    name: "MemberRegistered",
    type: "event",
    inputs: [
        { name: "resourceId", type: "bytes32", indexed: true },
        { name: "identityCommitment", type: "uint256", indexed: false },
    ],
} as const;

/** keccak(publisher ++ uid) — must match `resource_id_of` in the registry.
 *  The id is derived, not chosen, so it cannot be squatted or front-run. */
export const resourceIdOf = (publisher: Address, uid: Hex): Hex =>
    keccak256(concat([publisher, uid]));

/**
 * Deterministic Semaphore identity + stealth key from the buyer's wallet.
 * The identity commitment is what joins the group; the stealth address is what
 * the settlement (and the worker's /access gate) is keyed on, so the buyer's
 * main wallet never appears in the settlement.
 */
export async function deriveBuyer(
    walletClient: WalletClient,
): Promise<{ identity: Identity; stealthKey: Hex; stealthAddress: Address }> {
    const account = walletClient.account!;
    const signature = await walletClient.signMessage({ account, message: "fangorn:identity:v1" });
    const identity = new Identity(keccak256(toBytes(signature)));
    const stealthKey = keccak256(
        encodePacked(["string", "bytes32"], ["fangorn:stealth:", toHex(identity.secretScalar, { size: 32 })]),
    ) as Hex;
    return { identity, stealthKey, stealthAddress: privateKeyToAccount(stealthKey).address };
}

/** Semaphore's scope hash: keccak256(abi.encode(uint256)) >> 8, reducing into
 *  the BN254 field. Mirrors `hash` in @semaphore-protocol/utils. */
const hashScope = (scope: bigint): bigint =>
    BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [scope]))) >> 8n;

/**
 * The nullifier a proof for (identity, resourceId) will produce, without
 * building the proof — `poseidon2([hash(scope), secret])`, and the contract's
 * scope is the resourceId.
 *
 * The group is NOT an input. An earlier version hashed the group id instead,
 * which both cost an RPC and produced a number no proof would ever match.
 * Used to recover the nullifier for a resource already settled in a past
 * session, where re-proving would only burn gas to learn the same value.
 */
export const nullifierFor = (identity: Identity, resourceId: Hex): bigint =>
    poseidon2([hashScope(BigInt(resourceId)), identity.secretScalar]);

/**
 * Sign an EIP-3009 `transferWithAuthorization` for `amount` USDC paying `to`.
 *
 * `to` must be the resource owner: the registry reads the recipient from its own
 * storage and passes it to USDC, so an authorization naming anyone else simply
 * fails to transfer.
 */
export async function signTransferAuth(
    walletClient: WalletClient,
    params: {
        to: Address;
        amount: bigint;
        chain: Chain;
        usdcAddress: Address;
        usdcDomainName: string;
        usdcDomainVersion: string;
    },
): Promise<Erc3009Payment> {
    const account = walletClient.account!;
    const validAfter = 0n;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));

    const signature = await walletClient.signTypedData({
        account,
        domain: {
            name: params.usdcDomainName,
            version: params.usdcDomainVersion,
            chainId: params.chain.id,
            verifyingContract: params.usdcAddress,
        },
        types: {
            TransferWithAuthorization: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" },
                { name: "validBefore", type: "uint256" },
                { name: "nonce", type: "bytes32" },
            ],
        },
        primaryType: "TransferWithAuthorization",
        message: { from: account.address, to: params.to, value: params.amount, validAfter, validBefore, nonce },
    });

    const sig = parseSignature(signature);
    return {
        from: account.address,
        amount: params.amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
        v: Number(sig.v ?? BigInt(27 + (sig.yParity ?? 0))),
        r: sig.r,
        s: sig.s,
    };
}

/**
 * A free resource still has to `register` to join the group, but the registry
 * skips the transfer entirely when the amount is zero — so there is nothing to
 * sign and no signature to check. Demanding a wallet popup to move $0 would be
 * theatre.
 */
export const freePayment = (from: Address): Erc3009Payment => ({
    from,
    amount: "0",
    validAfter: "0",
    validBefore: "0",
    nonce: `0x${"00".repeat(32)}`,
    v: 0,
    r: `0x${"00".repeat(32)}`,
    s: `0x${"00".repeat(32)}`,
});

/**
 * Rebuild this resource's Semaphore group from on-chain events and prove
 * membership. Must run AFTER register, so the buyer's commitment is in the
 * group. Scope is the resourceId, which makes the nullifier deterministic per
 * (resource, identity) — see `nullifierFor`.
 */
export async function buildSettleProof(params: {
    publicClient: PublicClient;
    registry: Address;
    identity: Identity;
    resourceId: Hex;
    stealthAddress: Address;
    fromBlock?: bigint;
}): Promise<SettleProof> {
    const { publicClient, registry, identity, resourceId, stealthAddress } = params;

    // `args` filters on the indexed resourceId topic, which is what keeps the
    // rebuilt tree identical to the on-chain group for THIS resource — replaying
    // every resource's members would produce a root the contract rejects.
    //
    // ponytail: fromBlock 0 is fine on Arbitrum Sepolia's public RPC; pass
    // `fromBlock` (the registry's deploy block) if a stricter RPC caps the range.
    const logs = await publicClient.getLogs({
        address: registry,
        event: MEMBER_REGISTERED_EVENT,
        args: { resourceId },
        fromBlock: params.fromBlock ?? 0n,
    });

    const group = new Group();
    for (const log of logs) group.addMember((log.args as { identityCommitment: bigint }).identityCommitment);

    // Cheap offline guard: a proof over a group that lacks our commitment would
    // fail on-chain after paying gas. Catch it here instead.
    if (!group.members.map(String).includes(identity.commitment.toString())) {
        throw new Error("identity commitment not in group — did /verify (register) succeed?");
    }

    const proof = await generateProof(identity, group, BigInt(stealthAddress), BigInt(resourceId));

    return {
        resourceId,
        stealthAddress,
        merkleTreeDepth: proof.merkleTreeDepth.toString(),
        merkleTreeRoot: proof.merkleTreeRoot.toString(),
        nullifier: proof.nullifier.toString(),
        message: proof.message.toString(),
        points: proof.points.map(String),
        hookData: "0x",
    };
}

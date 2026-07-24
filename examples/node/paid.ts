// Paid-flow client helpers. Composes viem + Semaphore primitives to produce
// exactly what the facilitator relays on-chain:
//   /verify → register  : an EIP-3009 authorization + identity commitment
//   /settle → claim      : a Semaphore membership proof (scope = resourceId)
//
// The register/settle contract logic lives in the Stylus SettlementRegistry;
// the SDK no longer wraps it, so we build the payloads here.

import {
    encodePacked,
    keccak256,
    parseSignature,
    toBytes,
    toHex,
    type Address,
    type Hex,
    type PublicClient,
    type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";

/** register() adds every member (create_resource seeds + buyers) to ONE global
 * group and emits this event. To rebuild the group for a proof we replay them
 * all, in log order — NOT filtered by resource. */
const MEMBER_REGISTERED_EVENT = {
    name: "MemberRegistered",
    type: "event",
    inputs: [
        { name: "resourceId", type: "bytes32", indexed: true },
        { name: "identityCommitment", type: "uint256", indexed: false },
    ],
} as const;

/** EIP-3009 authorization the buyer signs, paying the owner the exact price. */
export interface Erc3009Payment {
    from: Address;
    to: Address;
    amount: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
    v: number;
    r: Hex;
    s: Hex;
}

export interface SettleProof {
    resourceId: Hex;
    stealthAddress: Address;
    merkleTreeDepth: string;
    merkleTreeRoot: string;
    nullifier: string;
    message: string;
    points: string[];
    hookData: Hex;
}

/**
 * Deterministic Semaphore identity + stealth key from the buyer's wallet.
 * The identity commitment is what gets registered in the group; the stealth
 * address is what the settlement (and the worker's /access gate) is keyed on,
 * so the buyer's main wallet never appears in the settlement.
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
    const stealthAddress = privateKeyToAccount(stealthKey).address;
    return { identity, stealthKey, stealthAddress };
}

/** Sign an EIP-3009 transferWithAuthorization for `amount` USDC, paying `to`. */
export async function signTransferAuth(
    walletClient: WalletClient,
    params: { to: Address; amount: bigint; usdcAddress: Address; usdcDomainName: string; usdcDomainVersion: string },
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
            chainId: arbitrumSepolia.id,
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
    const v = Number(sig.v ?? BigInt(27 + (sig.yParity ?? 0)));
    return {
        from: account.address,
        to: params.to,
        amount: params.amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
        v,
        r: sig.r,
        s: sig.s,
    };
}

/**
 * Rebuild the global Semaphore group from on-chain events and prove membership
 * for `resourceId`. Must run AFTER register (so the buyer's commitment is in
 * the group). The contract uses scope = resourceId, so the nullifier is
 * deterministic per (resource, identity).
 */
export async function buildSettleProof(params: {
    publicClient: PublicClient;
    registry: Address;
    identity: Identity;
    resourceId: Hex;
    stealthAddress: Address;
}): Promise<SettleProof> {
    const { publicClient, registry, identity, resourceId, stealthAddress } = params;

    // ponytail: fromBlock 0 is fine on Arbitrum Sepolia's public RPC (matches
    // the SDK's old fetchGroup); chunk the range if a stricter RPC rejects it.
    const logs = await publicClient.getLogs({ address: registry, event: MEMBER_REGISTERED_EVENT, fromBlock: 0n });

    const group = new Group();
    for (const log of logs) group.addMember((log.args as { identityCommitment: bigint }).identityCommitment);

    // Cheap offline guard: a proof over a group that lacks our commitment would
    // fail on-chain after paying gas. Catch it here instead.
    if (!group.members.map(String).includes(identity.commitment.toString())) {
        throw new Error("identity commitment not in group — was /verify (register) settled first?");
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

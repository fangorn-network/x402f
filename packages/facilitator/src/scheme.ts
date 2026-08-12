import {
    type SchemeNetworkFacilitator,
    type PaymentPayload,
    type PaymentRequirements,
    type VerifyResponse,
    type SettleResponse,
    type Network,
} from "@x402/core/types";
import { type FacilitatorEvmSigner } from "@x402/evm";
import {
    createPublicClient,
    createWalletClient,
    hexToBytes,
    http,
    type Chain,
    type Hex,
} from "viem";
import { type Address, privateKeyToAccount } from "viem/accounts";

/** hookData → the `uint8[]` the Stylus registry actually declares. Accepts the
 *  hex string clients send ("0x" when there is no hook) or an already-widened
 *  array; anything absent settles to empty. */
function toByteArray(hookData: unknown): readonly number[] {
    if (Array.isArray(hookData)) return hookData.map(Number);
    if (typeof hookData === "string" && hookData.startsWith("0x")) {
        return Array.from(hexToBytes(hookData as Hex));
    }
    return [];
}

// Full ABI for the on-chain writes the facilitator relays. The register/settle
// logic lives entirely in the Stylus SettlementRegistry now (the SDK no longer
// wraps the write path), so the facilitator is just a gas-paying relayer.
// Names are camelCased as Stylus exports them; input `name`s are cosmetic —
// only types + order matter for encoding.
export const SETTLEMENT_REGISTRY_ABI = [
    {
        name: "register",
        type: "function",
        stateMutability: "payable",
        inputs: [
            { name: "resourceId", type: "bytes32" },
            { name: "identityCommitment", type: "uint256" },
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
            { name: "v", type: "uint8" },
            { name: "r", type: "bytes32" },
            { name: "s", type: "bytes32" },
        ],
        outputs: [],
    },
    {
        name: "settle",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "resourceId", type: "bytes32" },
            { name: "stealthAddress", type: "address" },
            { name: "merkleTreeDepth", type: "uint256" },
            { name: "merkleTreeRoot", type: "uint256" },
            { name: "nullifier", type: "uint256" },
            { name: "message", type: "uint256" },
            { name: "points", type: "uint256[8]" },
            // uint8[], NOT bytes. The registry is a Stylus contract and this
            // parameter is a Rust `Vec<u8>`, which stylus exports as uint8[] —
            // see `cargo run --features export-abi` in contracts/settlement_registry.
            // Declaring it `bytes` changes the selector (0xf251249d instead of
            // 0x59f52fea), so the call hits no function at all and the Stylus
            // router reverts with EMPTY data — no custom error to decode, which
            // reads like a failed proof rather than a wrong signature.
            { name: "hookData", type: "uint8[]" },
        ],
        outputs: [],
    },
    {
        name: "getPrice",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "resourceId", type: "bytes32" }],
        outputs: [{ type: "uint256" }],
    },
    {
        name: "isSettled",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "stealthAddress", type: "address" },
            { name: "resourceId", type: "bytes32" },
        ],
        outputs: [{ type: "bool" }],
    },
] as const;

export type NullifierStore = Map<Hex, string>;

/**
 * FIFO async lock. Queues functions so they run serially on one key.
 * Used to serialize writes from the facilitator EOA and prevent
 * nonce collisions under concurrent verify/settle calls.
 */
class NonceMutex {
    private chain: Promise<unknown> = Promise.resolve();

    run<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.chain.then(fn, fn);
        // swallow errors on the internal chain so one failure doesn't
        // poison subsequent waiters; callers still see their own rejection
        this.chain = next.catch(() => {});
        return next;
    }
}

/** ERC-3009 authorization the buyer signs, paying the resource owner directly. */
interface Erc3009Payment {
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

export class FangornScheme implements SchemeNetworkFacilitator {
    readonly scheme = "exact";
    readonly caipFamily = "eip155:*";

    private readonly nullifiers: NullifierStore;
    private readonly publicClient: ReturnType<typeof createPublicClient>;
    private readonly viemClient: ReturnType<typeof createWalletClient>;
    private readonly lock = new NonceMutex();

    constructor(
        private readonly privateKey: Hex,
        private readonly signer: FacilitatorEvmSigner,
        private readonly registryAddress: Address,
        private readonly chain: Chain,
        rpcUrl: string,
        private readonly network: Network,
        nullifiers: NullifierStore,
    ) {
        this.nullifiers = nullifiers;
        this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
        this.viemClient = createWalletClient({
            account: privateKeyToAccount(privateKey),
            chain,
            transport: http(rpcUrl),
        });
    }

    /**
     * verify → register. The buyer already signed an ERC-3009 authorization
     * paying the resource owner the exact price. We relay one `register` call:
     * the contract runs the transferWithAuthorization and adds the buyer's
     * identity commitment to the global Semaphore group.
     */
    async verify(
        _payload: PaymentPayload,
        requirements: PaymentRequirements,
    ): Promise<VerifyResponse> {
        try {
            const extra = (requirements as any).extra as any;
            if (!extra?.resourceId) return { isValid: false, invalidReason: "Missing resourceId" };
            if (!extra?.identityCommitment) return { isValid: false, invalidReason: "Missing identityCommitment" };
            if (!extra?.payment) return { isValid: false, invalidReason: "Missing payment" };
            const p = extra.payment as Erc3009Payment;

            try {
                await this.lock.run(async () => {
                    const hash = await this.viemClient.writeContract({
                        address: this.registryAddress,
                        abi: SETTLEMENT_REGISTRY_ABI,
                        functionName: "register",
                        args: [
                            extra.resourceId as Hex,
                            BigInt(extra.identityCommitment),
                            p.from,
                            p.to,
                            BigInt(p.amount),
                            BigInt(p.validAfter),
                            BigInt(p.validBefore),
                            p.nonce,
                            p.v,
                            p.r,
                            p.s,
                        ],
                        chain: this.chain,
                        account: privateKeyToAccount(this.privateKey),
                    });
                    // waitForTransactionReceipt resolves on a REVERTED tx too —
                    // it only throws if the tx never lands. Without this check a
                    // revert is reported as a successful register, and the buyer
                    // finds out later when the gate says they never paid.
                    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
                    // Not the AlreadyRegistered path: writeContract estimates gas
                    // first, so that revert surfaces as a throw below, and
                    // this.lock serializes registers so two can't race into it.
                    if (receipt.status !== "success") throw new Error(`register reverted on-chain (tx ${hash})`);
                });
            } catch (e) {
                const msg = (e as Error).message;
                // Idempotent: a repeat buy of the same resource by the same
                // identity is already registered — fine, proceed to settle.
                if (!msg.includes("AlreadyRegistered")) {
                    return { isValid: false, invalidReason: msg };
                }
            }

            return { isValid: true };
        } catch (e) {
            return { isValid: false, invalidReason: (e as Error).message };
        }
    }

    /**
     * settle → claim. The buyer built a Semaphore membership proof off-chain.
     * We relay one `settle` call, which validates the proof on-chain and
     * records the settlement keyed by the buyer's stealth address. The
     * nullifier is a proof input (client-provided), echoed back so the caller
     * can gate access.
     */
    async settle(
        _payload: PaymentPayload,
        requirements: PaymentRequirements,
    ): Promise<SettleResponse> {
        try {
            const extra = (requirements as any).extra as any;
            const required = ["resourceId", "stealthAddress", "merkleTreeDepth", "merkleTreeRoot", "nullifier", "message", "points"];
            for (const k of required) {
                if (extra?.[k] === undefined) throw new Error(`Missing ${k}`);
            }

            const hash = await this.lock.run(() =>
                this.viemClient.writeContract({
                    address: this.registryAddress,
                    abi: SETTLEMENT_REGISTRY_ABI,
                    functionName: "settle",
                    // Semaphore proof verification is expensive; skip estimation.
                    gas: 8_000_000n,
                    args: [
                        extra.resourceId as Hex,
                        extra.stealthAddress as Address,
                        BigInt(extra.merkleTreeDepth),
                        BigInt(extra.merkleTreeRoot),
                        BigInt(extra.nullifier),
                        BigInt(extra.message),
                        (extra.points as (string | bigint)[]).map(BigInt) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
                        // Callers send hookData on the wire as a hex string ("0x"
                        // for the common no-hook case), but the parameter is
                        // uint8[] — viem will not encode a Hex into that. Widen
                        // here rather than at every caller, and accept an array
                        // as-is so a client that already sends one still works.
                        toByteArray(extra.hookData),
                    ],
                    chain: this.chain,
                    account: privateKeyToAccount(this.privateKey),
                }),
            );
            // As in register: a revert resolves here rather than throwing, and an
            // unchecked one becomes "settle succeeded" followed by the access gate
            // answering "not settled" — the failure named nowhere near its cause.
            const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
            if (receipt.status !== "success") throw new Error(`settle reverted on-chain (tx ${hash})`);

            const nullifier = String(extra.nullifier);
            this.nullifiers.set(extra.resourceId as Hex, nullifier);

            return {
                success: true,
                transaction: hash,
                payer: privateKeyToAccount(this.privateKey).address,
                network: this.network,
                extensions: { nullifier },
            };
        } catch (e) {
            return {
                success: false,
                errorReason: (e as Error).message,
                transaction: "0x",
                network: this.network,
            };
        }
    }

    getSigners(_network: string): string[] {
        return [...this.signer.getAddresses()] as string[];
    }

    getExtra(): Record<string, unknown> | undefined {
        return undefined;
    }
}

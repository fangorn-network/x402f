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
    http,
    type Chain,
    type Hex,
} from "viem";
import { type Address, privateKeyToAccount } from "viem/accounts";

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
            { name: "hookData", type: "bytes" },
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
                    await this.publicClient.waitForTransactionReceipt({ hash });
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
                        (extra.hookData ?? "0x") as Hex,
                    ],
                    chain: this.chain,
                    account: privateKeyToAccount(this.privateKey),
                }),
            );
            await this.publicClient.waitForTransactionReceipt({ hash });

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

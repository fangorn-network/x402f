// The buyer's whole path in one call: read the resource, pay for it if needed,
// prove the payment anonymously, and decrypt what comes back.
//
//   getUri/getPrice/getOwner/isDisabled   what am I buying, from whom
//   POST /verify  → register(…)           pay the owner, join the resource's group
//   POST /settle  → settle(…)             prove membership, record the stealth address
//   POST /access                          the worker releases the DEK
//
// The buyer's wallet signs; the facilitator pays every gas fee. The stealth
// address that appears on-chain is derived from the identity secret and is not
// linkable to the wallet that paid.

import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Identity } from "@semaphore-protocol/identity";
import { downloadAndDecrypt, unpackUri } from "./access.js";
import {
    buildSettleProof,
    deriveBuyer,
    freePayment,
    nullifierFor,
    resourceIdOf,
    signTransferAuth,
} from "./payment.js";
import type {
    FangornMiddlewareConfig,
    FetchResourceOptions,
    FetchResourceResult,
    ResourceRef,
} from "./types.js";

const REGISTRY_READ_ABI = [
    { name: "getUri", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "string" }] },
    { name: "getPrice", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
    { name: "getOwner", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
    { name: "isDisabled", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
    {
        name: "isSettled",
        type: "function",
        stateMutability: "view",
        inputs: [{ type: "address" }, { type: "bytes32" }],
        outputs: [{ type: "bool" }],
    },
] as const;

const resolve = (ref: ResourceRef): Hex =>
    "resourceId" in ref ? ref.resourceId : resourceIdOf(ref.publisher, ref.uid);

export class FangornX402Middleware {
    private constructor(
        private readonly config: Required<Pick<FangornMiddlewareConfig, "usdcDomainName" | "usdcDomainVersion">> &
            FangornMiddlewareConfig,
        private readonly publicClient: PublicClient,
        private readonly identity: Identity,
        private readonly stealthKey: Hex,
        readonly stealthAddress: Address,
    ) {}

    /** Derives the buyer's Semaphore identity, which costs one wallet signature.
     *  Everything after that is deterministic from it. */
    static async create(options: FangornMiddlewareConfig): Promise<FangornX402Middleware> {
        const { identity, stealthKey, stealthAddress } = await deriveBuyer(options.walletClient);
        const publicClient = createPublicClient({
            chain: options.chain,
            transport: http(options.rpcUrl),
        }) as PublicClient;

        return new FangornX402Middleware(
            { usdcDomainName: "USD Coin", usdcDomainVersion: "2", ...options },
            publicClient,
            identity,
            stealthKey,
            stealthAddress,
        );
    }

    /**
     * Fetch and decrypt a resource, paying for it first if this identity has not
     * settled it before.
     *
     * A resource already settled in an earlier session is NOT paid for again:
     * the settlement is on-chain and permanent, and the nullifier that unlocks
     * the worker is recomputable from the identity, so a wiped cache costs
     * nothing but a read.
     */
    async fetchResource(ref: ResourceRef, options: FetchResourceOptions = {}): Promise<FetchResourceResult> {
        try {
            const resourceId = resolve(ref);
            const registry = { address: this.config.registryAddress, abi: REGISTRY_READ_ABI } as const;
            const read = <T>(functionName: string, args: readonly unknown[]) =>
                this.publicClient.readContract({ ...registry, functionName, args } as never) as Promise<T>;

            const [uri, price, owner, disabled, settled] = await Promise.all([
                read<string>("getUri", [resourceId]),
                read<bigint>("getPrice", [resourceId]),
                read<Address>("getOwner", [resourceId]),
                read<boolean>("isDisabled", [resourceId]),
                read<boolean>("isSettled", [this.stealthAddress, resourceId]),
            ]);

            if (owner === "0x0000000000000000000000000000000000000000") {
                return { success: false, error: `resource ${resourceId} does not exist` };
            }
            // The registry reverts on register/settle for a disabled resource and
            // the worker refuses the DEK, so paying first would only lose money.
            if (disabled) return { success: false, error: `resource ${resourceId} is disabled` };

            const nullifier = settled
                ? nullifierFor(this.identity, resourceId).toString()
                : await this.payAndSettle(resourceId, owner, price);

            const resolved = unpackUri(uri);
            const data = await downloadAndDecrypt({
                resourceId,
                workerUrl: options.workerUrl ?? resolved.workerUrl,
                signer: privateKeyToAccount(this.stealthKey),
                nullifier: `0x${BigInt(nullifier).toString(16)}` as Hex,
                expectedPlaintextHash: resolved.plaintextHash,
            });

            return { success: true, data, nullifier, alreadySettled: settled };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /** register → settle through the facilitator. Returns the proof's nullifier. */
    private async payAndSettle(resourceId: Hex, owner: Address, price: bigint): Promise<string> {
        const payment =
            price > 0n
                ? await signTransferAuth(this.config.walletClient, {
                      to: owner,
                      amount: price,
                      chain: this.config.chain,
                      usdcAddress: this.config.usdcAddress,
                      usdcDomainName: this.config.usdcDomainName,
                      usdcDomainVersion: this.config.usdcDomainVersion,
                  })
                : freePayment(this.config.walletClient.account!.address);

        const verify = await this.postExtra("/verify", {
            resourceId,
            identityCommitment: this.identity.commitment.toString(),
            payment,
        });
        if (!verify.isValid) throw new Error(`verify (register) failed: ${verify.invalidReason}`);

        const proof = await buildSettleProof({
            publicClient: this.publicClient,
            registry: this.config.registryAddress,
            identity: this.identity,
            resourceId,
            stealthAddress: this.stealthAddress,
            fromBlock: this.config.fromBlock,
        });

        const settle = await this.postExtra("/settle", proof);
        if (!settle.success) throw new Error(`settle (claim) failed: ${settle.errorReason}`);
        return String(settle.extensions.nullifier);
    }

    /** The x402 envelope the facilitator expects; the Fangorn fields ride in `extra`. */
    private async postExtra(path: string, extra: object) {
        const res = await fetch(`${this.config.facilitatorUrl.replace(/\/$/, "")}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : {}),
            },
            body: JSON.stringify(
                {
                    paymentPayload: { x402Version: 2 },
                    paymentRequirements: {
                        scheme: "exact",
                        network: `eip155:${this.config.chain.id}`,
                        extra,
                    },
                },
                (_, v) => (typeof v === "bigint" ? v.toString() : v),
            ),
        });
        if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
        return res.json();
    }

    /** A wallet client for the stealth account — the identity the worker gates on. */
    stealthWalletClient() {
        return createWalletClient({
            account: privateKeyToAccount(this.stealthKey),
            chain: this.config.chain,
            transport: http(this.config.rpcUrl),
        });
    }
}

import { createPublicClient, createWalletClient, encodePacked, http, keccak256, toBytes, toHex, type Address, type Hex, type WalletClient } from "viem";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { type AppConfig, Fangorn } from "@fangorn-network/sdk";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { type ClientEvmSigner } from "@x402/evm";
import { SettlementRegistry } from "@fangorn-network/sdk/lib/registries/settlement-registry/index.js";
import { privateKeyToAccount } from "viem/accounts";
import { Identity } from "@semaphore-protocol/identity";
import { FangornMiddlewareConfig, type FetchResourceOptions, type FetchResourceResult } from "./types.js";

function createSignerFromWallet(walletClient: WalletClient, config: AppConfig): ClientEvmSigner {
    const account = walletClient.account;
    if (!account) throw new Error("WalletClient must have an account attached");

    const publicClient = createPublicClient({
        chain: walletClient.chain,
        transport: http(config.rpcUrl),
    });

    return {
        address: account.address,
        signTypedData: async (message) => walletClient.signTypedData({
            account: walletClient.account!.type === "local" ? account : account.address,
            domain: message.domain as any,
            types: message.types as any,
            primaryType: message.primaryType,
            message: message.message,
        }),
        readContract: (params) => publicClient.readContract(params as any),
    };
}

export class FangornX402Middleware {
    private readonly fangorn: Fangorn;
    private readonly fetchWithPayment: typeof fetch;
    private readonly walletClient: WalletClient;
    private readonly identity: Identity;
    private readonly stealthKey: Hex;
    private readonly stealthAddress: Address;
    private readonly fetchConfig: FangornMiddlewareConfig;

    private constructor(
        fangorn: Fangorn,
        fetchWithPayment: typeof fetch,
        walletClient: WalletClient,
        identity: Identity,
        stealthKey: Hex,
        stealthAddress: Address,
        fetchConfig: FangornMiddlewareConfig,
    ) {
        this.fangorn = fangorn;
        this.fetchWithPayment = fetchWithPayment;
        this.walletClient = walletClient;
        this.identity = identity;
        this.stealthKey = stealthKey;
        this.stealthAddress = stealthAddress;
        this.fetchConfig = fetchConfig;
    }

    static async create(options: FangornMiddlewareConfig): Promise<FangornX402Middleware> {
        const walletClient = options.walletClient
        // we only need to read from storage
        const fangorn = await Fangorn.create({
            walletClient,
            encryption: { lit: true },
            config: options.config,
            domain: options.domain,
        });

        const fetchWithPayment = wrapFetchWithPaymentFromConfig(
            globalThis.fetch.bind(globalThis),
            {
                schemes: [{
                    network: `eip155:${options.config.caip2}`,
                    client: new ExactEvmScheme(createSignerFromWallet(walletClient, options.config)),
                }],
            },
        );

        // Derive identity + stealth key
        const identitySecret = await deriveIdentitySecret(walletClient);
        const identity = new Identity(identitySecret);
        const stealthKey = keccak256(
            encodePacked(
                ['string', 'bytes32'],
                ['fangorn:stealth:', toHex(identity.secretScalar, { size: 32 })],
            )
        ) as Hex;

        const stealthAddress = privateKeyToAccount(stealthKey).address;

        return new FangornX402Middleware(
            fangorn,
            fetchWithPayment,
            walletClient,
            identity,
            stealthKey,
            stealthAddress,
            options,
        );
    }

    async fetchResource(options: FetchResourceOptions): Promise<FetchResourceResult> {
        const field = "audio";
        const usdcContractAddress = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address;
        const usdcDomainName = "USD Coin";
        const facilitatorAddress = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6" as Address;

        const {
            owner,
            schemaName,
            tag,
            baseUrl = "http://127.0.0.1:30333",
            authToken,
        } = options;

        try {
            // resolve schema
            let schemaId: Hex;
            try {
                schemaId = await this.fangorn.getSchemaRegistry().schemaId(schemaName);
            } catch {
                throw new Error(`Schema "${schemaName}" not found on-chain.`);
            }

            const resourceId = SettlementRegistry.deriveResourceId(owner, schemaId, tag);
            const price = await this.fangorn.getSettlementRegistry().getPrice(resourceId);

            // the client pays the facilitator (prepares a signed transferWithAuthorization call)
            const clientPayment = await this.fangorn.consumer.prepareRegister({
                walletClient: this.walletClient,
                paymentRecipient: facilitatorAddress,
                amount: price,
                usdcAddress: usdcContractAddress,
                usdcDomainName,
                usdcDomainVersion: "2",
            });

            // can be empty
            const authHeaders = authToken
                ? { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` }
                : { "Content-Type": "application/json" };

            // get the response from the verify call directly and handle it
            const verifyRes = await fetch(`${baseUrl}/verify`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    paymentPayload: {
                        x402Version: 2,
                    },
                    paymentRequirements: {
                        scheme: "exact",
                        network: `eip155:${this.fetchConfig.config.caip2}`,
                        amount: price.toString(),
                        asset: usdcContractAddress,
                        payTo: facilitatorAddress,
                        extra: {
                            name: usdcDomainName,
                            version: "2",
                            resourceId,
                            clientPayment,
                            identityCommitment: this.identity.commitment.toString(),
                            stealthAddress: this.stealthAddress,
                        },
                    },
                }, (_, v) => typeof v === "bigint" ? v.toString() : v),
            });

            const verifyBody = await verifyRes.json();

            if (!verifyBody.isValid) {
                return { success: false, error: `Verify failed: ${verifyBody.invalidReason}` };
            }

            // valid => isRegistered == true => prepare settle (builds semaphore proof)
            const preparedSettle = await this.fangorn.consumer.prepareSettle({
                resourceId,
                identity: this.identity,
                stealthAddress: this.stealthAddress,
            });

            // settle
            const settleRes = await fetch(`${baseUrl}/settle`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    paymentPayload: {
                        x402Version: 2,
                    },
                    paymentRequirements: {
                        scheme: "exact",
                        network: `eip155:${this.fetchConfig.config.caip2}`,
                        amount: price.toString(),
                        asset: usdcContractAddress,
                        payTo: facilitatorAddress,
                        extra: {
                            name: usdcDomainName,
                            version: "2",
                            resourceId,
                            preparedSettle,
                            stealthAddress: this.stealthAddress,
                        },
                    },
                }, (_, v) => typeof v === "bigint" ? v.toString() : v),
            });

            const settleBody = await settleRes.json();

            if (!settleBody.success) {
                return { success: false, error: `Settle failed: ${settleBody.errorReason}` };
            }

            const nullifierHash = BigInt(settleBody.extensions.nullifier);

            // decrypt
            const stealthWalletClient = createWalletClient({
                account: privateKeyToAccount(this.stealthKey),
                chain: this.fetchConfig.config.chain,
                transport: http(this.fetchConfig.config.rpcUrl),
            });

            const data = await this.fangorn.consumer.decrypt({
                owner,
                schemaId,
                tag,
                field,
                walletClient: stealthWalletClient,
                nullifierHash,
                identity: this.identity,
                skipSettlementCheck: true,
            });

            return {
                success: true,
                data,
                dataString: new TextDecoder().decode(data),
            };

        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    // helpers
    // todo: unsafe
    getAddress(): Hex {
        return this.walletClient.account!.address;
    }

    getPaymentFetch(): typeof fetch {
        return this.fetchWithPayment;
    }
}

async function deriveIdentitySecret(walletClient: WalletClient): Promise<Hex> {
    const message = 'fangorn:identity:v1'
    const signature = await walletClient.signMessage({
        account: walletClient.account!,
        message,
    })
    return keccak256(toBytes(signature))
}
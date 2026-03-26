import { createPublicClient, createWalletClient, encodePacked, http, keccak256, toHex, type Address, type Hex, type WalletClient } from "viem";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { type AppConfig, Fangorn } from "@fangorn-network/sdk";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { type ClientEvmSigner } from "@x402/evm";
import { SettlementRegistry } from "@fangorn-network/sdk/lib/registries/settlement-registry/index.js";
import { privateKeyToAccount } from "viem/accounts";
import { Identity } from "@semaphore-protocol/identity";
import { type FetchResourceOptions, type FetchResourceResult, type X402FExtra } from "./types.js";

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
    private readonly config: AppConfig;

    private constructor(
        fangorn: Fangorn,
        fetchWithPayment: typeof fetch,
        walletClient: WalletClient,
        identity: Identity,
        stealthKey: Hex,
        stealthAddress: Address,
        config: AppConfig,
    ) {
        this.fangorn = fangorn;
        this.fetchWithPayment = fetchWithPayment;
        this.walletClient = walletClient;
        this.identity = identity;
        this.stealthKey = stealthKey;
        this.stealthAddress = stealthAddress;
        this.config = config;
    }

    static async create(
        privateKey: Hex,
        config: AppConfig,
        domain: string,
        pinataJwt: string,
        pinataGateway: string,
    ): Promise<FangornX402Middleware> {
        const walletClient = createWalletClient({
            account: privateKeyToAccount(privateKey),
            chain: config.chain,
            transport: http(config.rpcUrl),
        });

        const fangorn = await Fangorn.create({
            privateKey,
            storage: { pinata: { jwt: pinataJwt, gateway: pinataGateway } },
            encryption: { lit: true },
            config,
            domain,
        });

        const fetchWithPayment = wrapFetchWithPaymentFromConfig(
            globalThis.fetch.bind(globalThis),
            {
                schemes: [{
                    network: `eip155:${config.caip2}`,
                    client: new ExactEvmScheme(createSignerFromWallet(walletClient, config)),
                }],
            },
        );

        // Derive identity + stealth key once — stable across sessions
        const identity = new Identity(privateKey);
        console.log('created identity')
        const stealthKey = keccak256(
            encodePacked(
                ["string", "bytes32"],
                ["fangorn:stealth:", toHex(identity.secretScalar, { size: 32 })],
            )
        ) as Hex;

        console.log('created stealth key ' + stealthKey)
        const stealthAddress = privateKeyToAccount(stealthKey).address;

        console.log('stealth address ' + stealthAddress)

        return new FangornX402Middleware(
            fangorn,
            fetchWithPayment,
            walletClient,
            identity,
            stealthKey,
            stealthAddress,
            config,
        );
    }

    async fetchResource(options: FetchResourceOptions): Promise<FetchResourceResult> {
        const field = "audio";
        const facilitatorUrl = "http://127.0.0.1:30333";
        const usdcContractAddress = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address;
        const usdcDomainName = "USD Coin";
        const facilitatorAddress = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6" as Address;

        const {
            owner,
            schemaName,
            tag,
            baseUrl = "http://127.0.0.1:4021",
            endpoint = "/",
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
            console.log("price:", price, "resourceId:", resourceId);

            // the client pays the facilitator (prepares a signed transferWithAuthorization call)
            const clientPayment = await this.fangorn.consumer.prepareRegister({
                // TODO
                burnerPrivateKey: "0xde0e6c1c331fcd8692463d6ffcf20f9f2e1847264f7a3f578cf54f62f05196cb",
                paymentRecipient: facilitatorAddress,
                amount: price,
                usdcAddress: usdcContractAddress,
                usdcDomainName,
                usdcDomainVersion: "2",
            });

            // get the response from the verify call directly and handle it
            const verifyRes = await fetch(`${facilitatorUrl}/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    paymentPayload: {
                        x402Version: 2,
                    },
                    paymentRequirements: {
                        scheme: "exact",
                        network: `eip155:${this.config.caip2}`,
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
            const settleRes = await fetch(`${facilitatorUrl}/settle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    paymentPayload: {
                        x402Version: 2,
                    },
                    paymentRequirements: {
                        scheme: "exact",
                        network: `eip155:${this.config.caip2}`,
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
                chain: this.config.chain,
                transport: http(this.config.rpcUrl),
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
    getAddress(): Hex {
        return this.walletClient.account!.address;
    }

    getPaymentFetch(): typeof fetch {
        return this.fetchWithPayment;
    }
}

export async function createFangornMiddleware(
    privateKey: Hex,
    config: AppConfig,
    domain: string,
    jwt: string,
    gateway: string,
): Promise<FangornX402Middleware> {
    return FangornX402Middleware.create(privateKey, config, domain, jwt, gateway);
}
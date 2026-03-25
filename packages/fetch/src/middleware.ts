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
        const stealthKey = keccak256(
            encodePacked(
                ["string", "bytes32"],
                ["fangorn:stealth:", toHex(identity.secretScalar)],
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
            config,
        );
    }

    async fetchResource(options: FetchResourceOptions): Promise<FetchResourceResult> {

        // TODO
        const field = "audio";
        const facilitatorAddress = "0x" as Address;
        const usdcContractAddress = "" as Address;
        const usdcDomainName = "USD Coin;"

        const {
            owner,
            schemaId,
            tag,
            baseUrl = "http://127.0.0.1:4021",
            endpoint = "/",
            authToken,
        } = options;

        try {
            const resourceId = SettlementRegistry.deriveResourceId(owner, schemaId, tag);
            const price = await this.fangorn.getSettlementRegistry().getPrice(resourceId);

            const clientPayment = await this.fangorn.consumer.prepareRegister({
                burnerPrivateKey: this.stealthKey,
                paymentRecipient: facilitatorAddress,
                amount: price,
                usdcAddress: usdcContractAddress,
                usdcDomainName: usdcDomainName,
                usdcDomainVersion: "2",
            });

            const preparedSettle = await this.fangorn.consumer.prepareSettle({
                resourceId,
                identity: this.identity,
                stealthAddress: this.stealthAddress,
            });

            const extra: X402FExtra = {
                name: usdcDomainName,
                version: "2",
                resourceId,
                identityCommitment: this.identity.commitment.toString(),
                stealthAddress: this.stealthAddress,
                preparedSettle,
                clientPayment,
            };

            const params = new URLSearchParams({ owner, schemaId, tag });
            const response = await this.fetchWithPayment(
                `${baseUrl}${endpoint}?${params.toString()}`,
                {
                    method: "GET",
                    headers: {
                        "Accept": "application/json",
                        "x402-extra": JSON.stringify(extra),
                        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                    },
                },
            );

            if (!response.ok) {
                return { success: false, error: `Request failed: ${response.status}` };
            }

            const body = await response.json() as {
                success: boolean;
                report: {
                    owner: Address;
                    schemaId: Hex;
                    tag: string;
                    entry: unknown;
                    nullifierHash: string;
                };
            };

            if (!body.success || !body.report.nullifierHash) {
                return { success: false, error: "Missing nullifierHash in response" };
            }

            const nullifierHash = BigInt(body.report.nullifierHash);

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
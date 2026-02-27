import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createPublicClient, http, type Address, type Hex, type WalletClient } from "viem";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { AppConfig, Fangorn, LitEncryptionService, PinataStorage } from "fangorn-sdk";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ClientEvmSigner } from "@x402/evm";

/**
 * Wraps a viem WalletClient to satisfy x402's signer interface
 */
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
            account: walletClient.account!.type === 'local' ? account : account.address,
            domain: message.domain as any,
            types: message.types as any,
            primaryType: message.primaryType,
            message: message.message,
        }),
        readContract: (params) => publicClient.readContract(params as any),
    };
}

export interface FangornMiddlewareConfig {
    pinataJwt: string;
    pinataGateway: string;
    appConfig: AppConfig;
    domain?: string;
}

export interface FetchResourceOptions {
    owner: Address,
    datasourceName: string;
    tag: string;
    baseUrl?: string;
    endpoint?: string;
}

export interface FetchResourceResult {
    success: boolean;
    data?: Uint8Array;
    dataString?: string;
    alreadyPaid?: boolean;
    paymentResponse?: unknown;
    error?: string;
}

export class FangornX402Middleware {
    private fangorn!: Fangorn;
    private x402Client!: x402Client;
    private fetchWithPayment!: typeof fetch;
    private walletClient: WalletClient;
    private initialized = false;

    constructor(walletClient: WalletClient) {
        if (!walletClient.account) {
            throw new Error("WalletClient must have an account attached");
        }
        this.walletClient = walletClient;
    }

    async init(config: AppConfig, domain: string, pinataJwt: string, pinataGateway: string): Promise<this> {
        if (this.initialized) return this;

        const encryptionService = await LitEncryptionService.init(config.chainName);

        const storageAdapter = new PinataStorage(pinataJwt, pinataGateway);

        this.fangorn = await Fangorn.init(this.walletClient, storageAdapter, encryptionService, domain, config);

        this.fetchWithPayment = wrapFetchWithPaymentFromConfig(globalThis.fetch.bind(globalThis), {
            schemes: [{
                network: `eip155:${config.caip2}`,
                client: new ExactEvmScheme(createSignerFromWallet(this.walletClient, config)),
            }],
        });

        this.initialized = true;
        return this;
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error("FangornX402Middleware not initialized. Call init() first.");
        }
    }

    /**
     * Fetch and decrypt a resource, handling x402 payment flow automatically
     */
    async fetchResource(options: FetchResourceOptions): Promise<FetchResourceResult> {
        this.ensureInitialized();

        const {
            owner,
            datasourceName,
            tag,
            baseUrl = "http://localhost  :4021",
            endpoint = "/",
        } = options;

        try {
            const params = new URLSearchParams({ owner, name: datasourceName, tag });
            console.log(`${baseUrl}${endpoint}?${params.toString()}`,);
            const response = await this.fetchWithPayment(
                `${baseUrl}${endpoint}?${params.toString()}`,
                {
                    method: "GET",
                    headers: { "Accept": "application/json" },
                }
            );

            console.log('adkjfhahjkfads')

            if (response.status === 402) {
                return {
                    success: false,
                    error: "Payment required but not processed",
                    alreadyPaid: false,mi
                };
            }

            if (response.ok) {
                const decryptedData = await this.fangorn.decryptFile(owner, datasourceName, tag);
                const dataString = new TextDecoder().decode(decryptedData);
                return {
                    success: true,
                    data: decryptedData,
                    dataString,
                };
            }

            return {
                success: false,
                error: `Unexpected response status: ${response.status}`,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Direct access to x402 client
     */
    getX402Client(): x402Client {
        this.ensureInitialized();
        return this.x402Client;
    }

    /**
     * Get the payment-wrapped fetch function for custom requests
     */
    getPaymentFetch(): typeof fetch {
        this.ensureInitialized();
        return this.fetchWithPayment;
    }

    /**
     * Get the connected wallet address
     */
    getAddress(): Hex {
        return this.walletClient.account!.address;
    }
}

export async function createFangornMiddleware(
    walletClient: WalletClient,
    config: AppConfig,
    domain: string,
    jwt: string,
    gateway: string,
): Promise<FangornX402Middleware> {
    const middleware = new FangornX402Middleware(walletClient);
    await middleware.init(config, domain, jwt, gateway);
    return middleware;
}

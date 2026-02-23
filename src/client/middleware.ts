import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbiParameters, type Address, type Hex, type WalletClient } from "viem";
import { createLitClient, type LitClient } from "@lit-protocol/lit-client";
import { nagaDev } from "@lit-protocol/networks";
import { ExactEvmScheme, registerExactEvmScheme } from "@x402/evm/exact/client";
import { AppConfig, Fangorn, FangornConfig, LitEncryptionService, PinataStorage } from "fangorn-sdk";
import { PinataSDK } from "pinata";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ClientEvmSigner } from "@x402/evm";

/**
 * x402's expected signer interface (not exported from package)
 */
interface X402EvmSigner {
    address: Hex;
    signTypedData: (message: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
    }) => Promise<Hex>;
}

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
    // id: Hex;
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
    private httpClient!: x402HTTPClient;
    private fetchWithPayment!: typeof fetch;
    private walletClient: WalletClient;

    private config: AppConfig;

    private initialized = false;

    constructor(walletClient: WalletClient, config: AppConfig) {
        if (!walletClient.account) {
            throw new Error("WalletClient must have an account attached");
        }
        this.walletClient = walletClient;
        this.config = config;
    }

    async init(config: AppConfig, domain: string, pinataJwt: string, pinataGateway: string): Promise<this> {
        if (this.initialized) return this;

        const litClient = await createLitClient({ network: nagaDev });
        const encryptionService = new LitEncryptionService(litClient, { chainName: config.chainName });

        const pinata = new PinataSDK({ pinataJwt, pinataGateway });
        const storageAdapter = new PinataStorage(pinata);

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
            baseUrl = "http://127.0.0.1:4021",
            endpoint = "/resource",
        } = options;

        try {
            const response = await this.fetchWithPayment(`${baseUrl}${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ owner, name: datasourceName, tag }),
            });

            const data = await response.json();
            // Check if already paid
            const alreadyPaid = (data as any).details?.includes("Already paid") ?? false;
            // Handle 402 Payment Required
            if (response.status === 402 && !alreadyPaid) {
                return {
                    success: false,
                    error: "Payment required but not processed",
                    alreadyPaid: false,
                };
            }

            // Process successful response
            if (response.ok || alreadyPaid) {
                console.log(JSON.stringify(response))
                // Decrypt the file
                const decryptedData = await this.fangorn.decryptFile(
                    owner, 
                    datasourceName, 
                    tag,
                );
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
    const middleware = new FangornX402Middleware(walletClient, config);
    await middleware.init(config, domain, jwt, gateway);
    return middleware;
}

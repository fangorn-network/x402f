import { AppConfig } from "@fangorn-network/sdk";
import { Address, Hex } from "viem";

export interface FangornMiddlewareConfig {
    // privateKey: Hex,
    walletClient: WalletClient;
    config: AppConfig;
    usdcContractAddress: Address;
    usdcDomainName: string;
    facilitatorAddress: Address;
    domain: string;
}

export interface FetchResourceOptions {
    privateKey: Hex,
    owner: Address,
    schemaName: string;
    tag: string;
    baseUrl: string;
    authToken?: string;
}

export interface FetchResourceResult {
    success: boolean;
    data?: Uint8Array;
    dataString?: string;
    alreadyPaid?: boolean;
    paymentResponse?: unknown;
    error?: string;
}

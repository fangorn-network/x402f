import { AppConfig } from "@fangorn-network/sdk";
import { Identity } from "@semaphore-protocol/identity";
import { Address, Hex, WalletClient } from "viem";

export interface FangornMiddlewareConfig {
    walletClient: WalletClient;
    config: AppConfig;
    usdcContractAddress: Address;
    usdcDomainName: string;
    facilitatorAddress: Address;
    domain: string;
}

export interface FetchResourceOptions {
    owner: Address,
    schemaName: string;
    name: string;
    baseUrl: string;
    nullifierHash?: string;
    authToken?: string;
}

export interface FetchResourceResult {
    success: boolean;
    data?: Uint8Array;
    alreadyPaid?: boolean;
    paymentResponse?: unknown;
    error?: string;
}

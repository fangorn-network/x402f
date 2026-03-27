import { AppConfig } from "@fangorn-network/sdk";
import { Address } from "viem";

export interface FangornMiddlewareConfig {
    pinataJwt: string;
    pinataGateway: string;
    appConfig: AppConfig;
    domain?: string;
}

export interface FetchResourceOptions {
    owner: Address,
    schemaName: string;
    tag: string;
    baseUrl?: string;
    endpoint?: string;
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

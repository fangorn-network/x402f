import { AppConfig } from "@fangorn-network/sdk";
import { PrepareSettleResult, TransferWithAuthPayload } from "@fangorn-network/sdk/lib/registries/settlement-registry/types.js";
import { Address, Hex } from "viem";

export interface X402FExtra {
    name: string;
    version: string;
    resourceId: Hex;
    // bigint as string
    identityCommitment: string;
    stealthAddress: Address;
    preparedSettle: PrepareSettleResult;
    // from: buyer, to: facilitator
    clientPayment: TransferWithAuthPayload;
}

export interface FangornMiddlewareConfig {
    pinataJwt: string;
    pinataGateway: string;
    appConfig: AppConfig;
    domain?: string;
}

export interface FetchResourceOptions {
    owner: Address,
    schemaId: Hex;
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

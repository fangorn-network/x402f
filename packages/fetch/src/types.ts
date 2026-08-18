import type { Address, Chain, Hex, WalletClient } from "viem";

export interface FangornMiddlewareConfig {
    /** The buyer's wallet. Signs the identity seed and the USDC authorization;
     *  never pays gas — the facilitator relays every write. */
    walletClient: WalletClient;
    chain: Chain;
    rpcUrl: string;
    /** The Stylus SettlementRegistry the facilitator relays to. */
    registryAddress: Address;
    usdcAddress: Address;
    /** Base URL of the x402f facilitator, e.g. http://localhost:30333 */
    facilitatorUrl: string;
    /** EIP-712 domain of the USDC deployment. Defaults match Circle's testnet USDC. */
    usdcDomainName?: string;
    usdcDomainVersion?: string;
    /** Earliest block to scan for group members. Defaults to 0; set it to the
     *  registry's deploy block if the RPC caps `eth_getLogs` ranges. */
    fromBlock?: bigint;
    /** Sent as `Authorization: Bearer …` to the facilitator, if it requires one. */
    authToken?: string;
}

/** Identify a resource either directly, or the way its publisher thinks of it —
 *  the registry derives `resourceId = keccak(publisher ++ uid)`. */
export type ResourceRef = { resourceId: Hex } | { publisher: Address; uid: Hex };

export interface FetchResourceOptions {
    /** Overrides the worker URL packed into the on-chain uri. Rarely needed;
     *  useful to point a client at a local worker. */
    workerUrl?: string;
}

export interface FetchResourceResult {
    success: boolean;
    data?: Uint8Array;
    /** True when the caller had already settled and no payment was made. */
    alreadySettled?: boolean;
    /** The Semaphore nullifier that authorized the read. */
    nullifier?: string;
    error?: string;
}

/** EIP-3009 authorization the buyer signs. There is no `to`: the registry reads
 *  the recipient from `resource_owners[resourceId]`. */
export interface Erc3009Payment {
    from: Address;
    amount: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
    v: number;
    r: Hex;
    s: Hex;
}

export interface SettleProof {
    resourceId: Hex;
    stealthAddress: Address;
    merkleTreeDepth: string;
    merkleTreeRoot: string;
    nullifier: string;
    message: string;
    points: string[];
    hookData: Hex;
}

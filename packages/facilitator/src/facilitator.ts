import { x402Facilitator } from "@x402/core/facilitator";
import { Network } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/facilitator";
// Import config from the subpath, not the package root: the published SDK's
// root re-exports its crypto module, whose bundled `@noble/ciphers` import is
// broken and crashes on load. The facilitator only needs the config object.
import { type AppConfig, FangornConfig } from "@fangorn-network/sdk/lib/config.js";
import { createWalletClient, Hex, http, publicActions } from "viem";
import { Account, Address, privateKeyToAccount } from "viem/accounts";
import { FangornScheme, type NullifierStore } from "./scheme.js";

/**
 * Initialize and configure the x402 facilitator.
 * Called lazily on first use to support Next.js module loading.
 *
 *  `config`: The Fangorn app config (chain, rpcUrl, caip2)
 *  `network`: The x402 network id, e.g. `eip155:421614`
 * `evmAccount`: The facilitator's relayer account (pays gas)
 * `registryAddress`: The Stylus SettlementRegistry the facilitator relays to
 *
 * @returns A configured x402Facilitator instance
 */
function createFacilitator(
    privateKey: Hex,
    config: AppConfig,
    network: Network,
    evmAccount: Account,
    registryAddress: Address,
): x402Facilitator {
    // Create a Viem client with both wallet and public capabilities
    const viemClient = createWalletClient({
        account: evmAccount,
        chain: config.chain,
        transport: http(config.rpcUrl),
    }).extend(publicActions);

    const nullifierStore: NullifierStore = new Map();

    // Initialize the x402 Facilitator with EVM signer
    const evmSigner = toFacilitatorEvmSigner({
        address: evmAccount.address,
        readContract: (args: {
            address: `0x${string}`;
            abi: readonly unknown[];
            functionName: string;
            args?: readonly unknown[];
        }) =>
            viemClient.readContract({
                ...args,
                args: args.args || [],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any),
        verifyTypedData: (args: {
            address: `0x${string}`;
            domain: Record<string, unknown>;
            types: Record<string, unknown>;
            primaryType: string;
            message: Record<string, unknown>;
            signature: `0x${string}`;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) => viemClient.verifyTypedData(args as any),
        writeContract: (args: {
            address: `0x${string}`;
            abi: readonly unknown[];
            functionName: string;
            args: readonly unknown[];
        }) =>
            viemClient.writeContract({
                ...args,
                args: args.args || [],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any),
        sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            viemClient.sendTransaction({ to: args.to, data: args.data } as any),
        waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
            viemClient.waitForTransactionReceipt(args),
        getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
    });

    // Create and configure the facilitator. The standard x402 exact scheme is
    // registered for wire-compat; the Fangorn register/claim flow is the
    // custom scheme handling this network.
    const facilitator = new x402Facilitator()
        .registerV1(network, new ExactEvmSchemeV1(evmSigner))
        .register(
            `eip155:${config.caip2}`,
            new FangornScheme(
                privateKey,
                evmSigner,
                registryAddress,
                config.chain,
                config.rpcUrl,
                `eip155:${config.caip2}` as Network,
                nullifierStore,
            ),
        );

    return facilitator;
}

// Lazy initialization
let _facilitator: x402Facilitator | null = null;

/**
 * Get the configured facilitator instance.
 * Uses lazy initialization to create the facilitator on first access.
 */
export function getFacilitator(): x402Facilitator {
    if (!_facilitator) {
        const privkey = process.env.FACILITATOR_EVM_PRIVATE_KEY;
        if (!privkey) {
            throw new Error("❌ FACILITATOR_EVM_PRIVATE_KEY environment variable is required");
        }
        const registryAddress = process.env.SETTLEMENT_REGISTRY_ADDR;
        if (!registryAddress) {
            throw new Error("❌ SETTLEMENT_REGISTRY_ADDR environment variable is required");
        }

        const evmAccount = privateKeyToAccount(privkey as `0x${string}`);

        // ponytail: single network (Arbitrum Sepolia). FangornConfig is the
        // source of truth for chain/rpc/caip2; add multichain when a second
        // network actually ships.
        _facilitator = createFacilitator(
            privkey as Hex,
            FangornConfig,
            `eip155:${FangornConfig.caip2}` as Network,
            evmAccount,
            registryAddress as Address,
        );
    }

    return _facilitator;
}
import { x402Facilitator } from "@x402/core/facilitator";
import { Network } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/facilitator";
import { AppConfig, FangornConfig } from "fangorn-sdk";
import { createWalletClient, http, publicActions } from "viem";
import { Account, Address, privateKeyToAccount } from "viem/accounts";
import { ContentRegistryScheme } from "./scheme.js";

/**
 * Initialize and configure the x402 facilitator with EVM and SVM support
 * This is called lazily on first use to support Next.js module loading
 *
 *  `config`: The Fangorn app config
 *  `network`: The network name for x402 e.g. `${"base-sepolia" as Network}` for Base Sepolia
 * `evmAccount`: The EVM account to use
 * 
 * @returns A configured x402Facilitator instance
 */
async function createFacilitator(
	config: AppConfig,
	network: Network,
	evmAccount: Account,
	usdcDomainName: string,
	usdcContractAddress: Address,
	settlementTrackerAddress: Address,
): Promise<x402Facilitator> {
	// Create a Viem client with both wallet and public capabilities
	const viemClient = createWalletClient({
		account: evmAccount,
		chain: config.chain,
		transport: http(config.rpcUrl),
	}).extend(publicActions);

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

	// Create and configure the facilitator

	const facilitator = new x402Facilitator()
		.registerV1(network, new ExactEvmSchemeV1(evmSigner))
		.register(
			`eip155:${config.caip2}`,
			new ContentRegistryScheme(
				evmSigner,
				// settlement tracker address
				settlementTrackerAddress as Address,
				usdcContractAddress as Address,
				config.caip2,
				usdcDomainName,
				`eip155:${config.caip2}`
			)
		);

	return facilitator;
}

// Lazy initialization
let _facilitatorPromise: Promise<x402Facilitator> | null = null;

/**
 * Get the configured facilitator instance
 * Uses lazy initialization to create the facilitator on first access
 *
 * @returns A promise that resolves to the configured facilitator
 */
export async function getFacilitator(): Promise<x402Facilitator> {

	if (!_facilitatorPromise) {
		const privkey = process.env.FACILITATOR_EVM_PRIVATE_KEY;
		if (!privkey) {
			throw new Error("❌ FACILITATOR_EVM_PRIVATE_KEY environment variable is required");
		}

		const usdcDomainName = process.env.USDC_DOMAIN_NAME!;
		const usdcContractAddress = process.env.USDC_CONTRACT_ADDR!;
		const settlementTrackerAddress = process.env.SETTLEMENT_TRACKER_ADDR!;
		const chainName = process.env.CHAIN!

		// Initialize the EVM account from private key
		const evmAccount = privateKeyToAccount(privkey as `0x${string}`);

		// TODO: can the facilitator can support multiple networks?
		// default to arbitrum
		let config = FangornConfig.ArbitrumSepolia;
		let networkString = "arbitrum-sepolia";

		if (chainName === "baseSepolia") {
			networkString = "base-sepolia";
			config = FangornConfig.BaseSepolia;
		}

		_facilitatorPromise = createFacilitator(
			config,
			networkString as Network,
			evmAccount,
			usdcDomainName,
			usdcContractAddress as Address,
			settlementTrackerAddress as Address,
		);
	}

	return _facilitatorPromise;
}
import { x402Facilitator } from "@x402/core/facilitator";
import { Network } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/facilitator";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ContentRegistryScheme } from "./scheme";

/**
 * Initialize and configure the x402 facilitator with EVM and SVM support
 * This is called lazily on first use to support Next.js module loading
 *
 * @returns A configured x402Facilitator instance
 */
async function createFacilitator(): Promise<x402Facilitator> {
  // Validate required environment variables
  if (!process.env.FACILITATOR_EVM_PRIVATE_KEY) {
    throw new Error("❌ FACILITATOR_EVM_PRIVATE_KEY environment variable is required");
  }

  // Initialize the EVM account from private key
  const evmAccount = privateKeyToAccount(process.env.FACILITATOR_EVM_PRIVATE_KEY as `0x${string}`);

  // Create a Viem client with both wallet and public capabilities
  const viemClient = createWalletClient({
    account: evmAccount,
    chain: baseSepolia,
    transport: http(),
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
    // .register("eip155:84532", new ExactEvmScheme(evmSigner))
    .registerV1("base-sepolia" as Network, new ExactEvmSchemeV1(evmSigner))
    .register(
      "eip155:84532",
      new ContentRegistryScheme(
        evmSigner,
        "0x11afe8c3d81963bafbb6c259216b914843e44500",
        // Base Sepolia USDC
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e" 
      )
    )
    .registerExtension("bazaar");

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
    _facilitatorPromise = createFacilitator();
  }
  return _facilitatorPromise;
}
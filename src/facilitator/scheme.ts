import {
    SchemeNetworkFacilitator,
    PaymentPayload,
    PaymentRequirements,
    VerifyResponse,
    SettleResponse,
    Network
} from "@x402/core/types";
import { FacilitatorEvmSigner } from "@x402/evm";
import { parseSignature, verifyTypedData } from "viem";

const REGISTRY_ABI = [
  {
    name: "pay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "commitment", type: "bytes32" },
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export class ContentRegistryScheme implements SchemeNetworkFacilitator {
    readonly scheme = "exact";
    readonly caipFamily = "eip155:*";

    constructor(
        private readonly signer: FacilitatorEvmSigner,
        private readonly registryAddress: `0x${string}`,
        private readonly usdcAddress: `0x${string}`,
        private readonly network: Network = "eip155:84532" // Default to Base Sepolia
    ) { }

    /**
     * MANUAL STANDARD VERIFY
     * Replicates what x402 does: checks EIP-712 signature + amount/recipient match
     */
    async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
        try {
            const p = payload.payload as any;
            const auth = p.authorization;

            // 1. Validate that the payload matches what the facilitator expects (USDC details)
            if (BigInt(auth.value) < BigInt(requirements.amount)) {
                return { isValid: false, invalidReason: "Insufficient amount" };
            }
            if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
                return { isValid: false, invalidReason: "Recipient mismatch" };
            }

            // 2. Verify the EIP-3009 Signature (The "Standard" part)
            const valid = await verifyTypedData({
                address: auth.from,
                domain: {
                    name: "USDC", // Check your specific chain's USDC name (usually "USD Coin")
                    version: "2",
                    chainId: 84532, // Base Sepolia
                    verifyingContract: this.usdcAddress,
                },
                types: {
                    TransferWithAuthorization: [
                        { name: "from", type: "address" },
                        { name: "to", type: "address" },
                        { name: "value", type: "uint256" },
                        { name: "validAfter", type: "uint256" },
                        { name: "validBefore", type: "uint256" },
                        { name: "nonce", type: "bytes32" },
                    ],
                },
                primaryType: "TransferWithAuthorization",
                message: {
                    from: auth.from,
                    to: auth.to,
                    value: BigInt(auth.value),
                    validAfter: BigInt(auth.validAfter),
                    validBefore: BigInt(auth.validBefore),
                    nonce: auth.nonce,
                },
                signature: p.signature,
            });

            return { isValid: valid };
        } catch (e) {
            return { isValid: false, invalidReason: (e as Error).message };
        }
    }

    async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
        try {
            const p = payload.payload as any;
            const auth = p.authorization;
            const commitment = (p.metadata as any)?.commitment;

            if (!commitment) throw new Error("Missing commitment in metadata");
            if (!p.signature) throw new Error("Missing signature in payload");

            const { v, r, s } = parseSignature(p.signature);

            const hash = await this.signer.writeContract({
                address: this.registryAddress,
                abi: REGISTRY_ABI,
                functionName: "pay",
                args: [
                    commitment,
                    auth.from,
                    auth.to,
                    BigInt(auth.value),
                    BigInt(auth.validAfter),
                    BigInt(auth.validBefore),
                    auth.nonce,
                    Number(v),
                    r,
                    s,
                ],
            });

            // Map the viem hash to the SettleResponse type
            return {
                success: true,
                transaction: hash,
                payer: this.signer.getAddresses()[0],
                network: this.network,
            };
        } catch (e) {
            return {
                success: false,
                errorReason: (e as Error).message,
                transaction: "0x",
                network: this.network,
            };
        }
    }

    getSigners(_network: string): string[] {
        return [...this.signer.getAddresses()] as string[];
    }
    getExtra(): Record<string, unknown> | undefined {
        return undefined;
    }
}
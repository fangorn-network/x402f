import {
    SchemeNetworkFacilitator,
    PaymentPayload,
    PaymentRequirements,
    VerifyResponse,
    SettleResponse,
    Network
} from "@x402/core/types";
import { FacilitatorEvmSigner } from "@x402/evm";
import { fieldToHex, SETTLEMENT_TRACKER_ABI } from "fangorn-sdk";
import { Hex, parseSignature, toHex, verifyTypedData } from "viem";

export class ContentRegistryScheme implements SchemeNetworkFacilitator {
    readonly scheme = "exact";
    readonly caipFamily = "eip155:*";

    constructor(
        private readonly signer: FacilitatorEvmSigner,
        private readonly settlementTrackerAddress: Hex,
        private readonly usdcAddress: Hex,
        private readonly caip2: number,
        private readonly usdcDomain: string,
        private readonly network: Network
    ) { }

    /**
     * MANUAL STANDARD VERIFY 
     * Replicates what x402 does: checks EIP-712 signature + amount/recipient match
     */
    async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
        try {
            const p = payload.payload as any;
            const auth = p.authorization;

            // validations
            if (BigInt(auth.value) < BigInt(requirements.amount)) {
                return { isValid: false, invalidReason: "Insufficient amount" };
            }
            if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
                return { isValid: false, invalidReason: "Recipient mismatch" };
            }

            // Verify the EIP-3009 Signature
            const valid = await verifyTypedData({
                address: auth.from,
                domain: {
                    name: this.usdcDomain,
                    version: "2",
                    chainId: this.caip2,
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

    /**
     * Settle the payment
     * @param payload 
     * @param requirements 
     * @returns 
     */
    async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
        try {
            const p = payload.payload as any;
            const auth = p.authorization;

            const commitment = (requirements as any).extra?.commitment;
            if (!commitment) throw new Error("Missing commitment in metadata");
            if (!p.signature) throw new Error("Missing signature in payload");
            const { v, r, s } = parseSignature(p.signature);

            const hash = await this.signer.writeContract({
                address: this.settlementTrackerAddress,
                abi: SETTLEMENT_TRACKER_ABI,
                functionName: "pay",
                args: [
                    fieldToHex(BigInt(commitment)),
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
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { PaymentRequirements } from "@x402/core/types";

export class FangornEvmScheme extends ExactEvmScheme {
    async enhancePaymentRequirements(
        requirements: PaymentRequirements,
        supportedKind: any,
        facilitatorExtensions: string[]
    ): Promise<PaymentRequirements> {
        // Save your original extra (with commitment)
        const originalExtra = (requirements as any).extra;

        // Let the base class add EIP-712 info
        const enhanced = await super.enhancePaymentRequirements(
            requirements,
            supportedKind,
            facilitatorExtensions
        );

        (enhanced as any).extra = {
            ...(enhanced as any).extra,   // EIP-712: { name: "USDC", version: "2" }
            ...originalExtra,
        };

        return enhanced;
    }
}
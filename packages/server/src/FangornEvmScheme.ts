import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { PaymentRequirements } from "@x402/core/types";

export class FangornEvmScheme extends ExactEvmScheme {
    async enhancePaymentRequirements(
        requirements: PaymentRequirements,
        supportedKind: any,
        facilitatorExtensions: string[]
    ): Promise<PaymentRequirements> {
        // store original extra (with commitment)
        const originalExtra = (requirements as any).extra;

        // add EIP-712 info
        const enhanced = await super.enhancePaymentRequirements(
            requirements,
            supportedKind,
            facilitatorExtensions
        );

        (enhanced as any).extra = {
            // EIP-712: { name: "USDC", version: "2" }
            ...(enhanced as any).extra,
            ...originalExtra,
        };

        return enhanced;
    }
}
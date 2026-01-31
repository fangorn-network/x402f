import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { PaymentRequirements } from "@x402/core/types";

export class FangornEvmScheme extends ExactEvmScheme {
    async enhancePaymentRequirements(
        requirements: PaymentRequirements,
        supportedKind: any,
        facilitatorExtensions: string[]
    ): Promise<PaymentRequirements> {
        // console.log('=== RAW REQUIREMENTS INPUT ===');
        // console.log(JSON.stringify(requirements, null, 2));
        // console.log('supportedKind:', JSON.stringify(supportedKind, null, 2));
        // console.log('==============================');
        // Save your original extra (with commitment)
        const originalExtra = (requirements as any).extra;

        // Let the base class add EIP-712 info
        const enhanced = await super.enhancePaymentRequirements(
            requirements,
            supportedKind,
            facilitatorExtensions
        );

        // Merge: keep EIP-712 info AND your commitment
        (enhanced as any).extra = {
            ...(enhanced as any).extra,   // EIP-712: { name: "USDC", version: "2" }
            ...originalExtra,
        };

        // console.log('Original extra:', originalExtra);
        // console.log('Enhanced extra:', (enhanced as any).extra);

        return enhanced;
    }
}
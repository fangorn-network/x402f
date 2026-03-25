import {
    type SchemeNetworkFacilitator,
    type PaymentPayload,
    type PaymentRequirements,
    type VerifyResponse,
    type SettleResponse,
    type Network,
} from "@x402/core/types";
import { type FacilitatorEvmSigner } from "@x402/evm";
import { Fangorn } from "@fangorn-network/sdk";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { type Address, generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ERC20_TRANSFER_ABI = [{
    name: "transfer",
    type: "function",
    inputs: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
}] as const;

export type NullifierStore = Map<Hex, bigint>;

export class ContentRegistryScheme implements SchemeNetworkFacilitator {
    readonly scheme = "exact";
    readonly caipFamily = "eip155:*";

    // nullifiers keyed by resourceId, consumed once by GET /
    private readonly nullifiers: NullifierStore;

    private readonly publicClient: ReturnType<typeof createPublicClient>;
    private readonly viemClient: ReturnType<typeof createWalletClient>;

    constructor(
        private readonly privateKey: Hex,
        private readonly signer: FacilitatorEvmSigner,
        private readonly fangorn: Fangorn,
        private readonly usdcAddress: Hex,
        // private readonly caip2: number,
        // private readonly usdcDomain: string,
        private readonly network: Network,
        nullifiers: NullifierStore,
    ) {
        this.nullifiers = nullifiers;

        const config = fangorn.getConfig();

        this.publicClient = createPublicClient({
            chain: config.chain,
            transport: http(config.rpcUrl),
        });

        this.viemClient = createWalletClient({
            account: privateKeyToAccount(privateKey),
            chain: config.chain,
            transport: http(config.rpcUrl),
        });
    }

    async verify(
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ): Promise<VerifyResponse> {
        try {
            const extra = (requirements as any).extra as any;

            if (!extra?.clientPayment) return { isValid: false, invalidReason: "Missing clientPayment" };
            if (!extra?.preparedSettle) return { isValid: false, invalidReason: "Missing preparedSettle" };
            if (!extra?.identityCommitment) return { isValid: false, invalidReason: "Missing identityCommitment" };
            if (!extra?.stealthAddress) return { isValid: false, invalidReason: "Missing stealthAddress" };
            if (!extra?.resourceId) return { isValid: false, invalidReason: "Missing resourceId" };

            const price = BigInt(requirements.amount);

            // Step 1: collect reimbursement from client (buyer → facilitator)
            await this.fangorn.getSettlementRegistry().register({
                resourceId: extra.resourceId,
                identityCommitment: BigInt(extra.identityCommitment),
                relayerPrivateKey: this.privateKey,
                preparedRegister: extra.clientPayment,
            });

            // Step 2: generate fresh burner, fund from facilitator's USDC reserves
            const burnerKey = generatePrivateKey();
            const burnerAddress = privateKeyToAccount(burnerKey).address;
            await this.transferUsdc(burnerAddress, price);

            // Step 3: burner signs ERC-3009 → resource owner
            const preparedRegister = await this.fangorn.getSettlementRegistry()
                .prepareTransferWithAuth({
                    burnerPrivateKey: burnerKey,
                    paymentRecipient: requirements.payTo as Address,
                    amount: price,
                    usdcAddress: this.usdcAddress,
                    usdcDomainName: extra.name,
                    usdcDomainVersion: extra.version,
                });

            // Step 4: submit anonymous register — burner pays owner on-chain
            await this.fangorn.getSettlementRegistry().register({
                resourceId: extra.resourceId,
                identityCommitment: BigInt(extra.identityCommitment),
                relayerPrivateKey: this.privateKey,
                preparedRegister,
            });

            return { isValid: true };
        } catch (e) {
            return { isValid: false, invalidReason: (e as Error).message };
        }
    }

    async settle(
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ): Promise<SettleResponse> {
        try {
            const extra = (requirements as any).extra as any;
            if (!extra?.preparedSettle) throw new Error("Missing preparedSettle");
            if (!extra?.resourceId) throw new Error("Missing resourceId");

            const { hash, nullifier } = await this.fangorn.getSettlementRegistry().settle({
                relayerPrivateKey: this.privateKey,
                preparedSettle: extra.preparedSettle,
            });

            // store for GET / to consume — keyed by resourceId
            this.nullifiers.set(extra.resourceId as Hex, nullifier);

            return {
                success: true,
                transaction: hash,
                payer: privateKeyToAccount(this.privateKey).address,
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

    private async transferUsdc(to: Address, amount: bigint): Promise<void> {
        const hash = await this.viemClient.writeContract({
            address: this.usdcAddress,
            abi: ERC20_TRANSFER_ABI,
            functionName: "transfer",
            args: [to, amount],
            chain: this.fangorn.getConfig().chain,
            account: privateKeyToAccount(this.privateKey),
        });
        await this.publicClient.waitForTransactionReceipt({ hash });
    }

    getSigners(_network: string): string[] {
        return [...this.signer.getAddresses()] as string[];
    }

    getExtra(): Record<string, unknown> | undefined {
        return undefined;
    }
}
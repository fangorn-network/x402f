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

    private readonly nullifiers: NullifierStore;
    private readonly publicClient: ReturnType<typeof createPublicClient>;
    private readonly viemClient: ReturnType<typeof createWalletClient>;

    constructor(
        private readonly privateKey: Hex,
        private readonly signer: FacilitatorEvmSigner,
        private readonly fangorn: Fangorn,
        private readonly usdcAddress: Hex,
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
        requirements: PaymentRequirements
    ): Promise<VerifyResponse> {
        try {
            const extra = (requirements as any).extra as any;

            if (!extra?.identityCommitment) return { isValid: false, invalidReason: "Missing identityCommitment" };
            if (!extra?.resourceId) return { isValid: false, invalidReason: "Missing resourceId" };

            const price = BigInt(requirements.amount);

            // facilitator funds fresh anonymous burner
            const burnerKey = generatePrivateKey();
            const burnerAddress = privateKeyToAccount(burnerKey).address;
            await this.transferUsdc(burnerAddress, price);

            // burner prepares ERC-3009 to resource owner
            const preparedRegister = await this.fangorn.getSettlementRegistry()
                .prepareTransferWithAuth({
                    burnerPrivateKey: burnerKey,
                    paymentRecipient: requirements.payTo as Address,
                    amount: price,
                    usdcAddress: this.usdcAddress,
                    usdcDomainName: extra.name,
                    usdcDomainVersion: extra.version,
                });

            // burner pays owner, identity registers in the appropriate semaphore group
            try {
                await this.fangorn.getSettlementRegistry().register({
                    resourceId: extra.resourceId,
                    identityCommitment: BigInt(extra.identityCommitment),
                    relayerPrivateKey: this.privateKey,
                    preparedRegister,
                });
            } catch (e) {
                const msg = (e as Error).message;
                if (!msg.includes("AlreadyRegistered")) {
                    return { isValid: false, invalidReason: msg };
                }
                console.log("already registered, proceeding to settle");
            }

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
            
            // claim membership in semaphore group 
            const { hash, nullifier } = await this.fangorn.getSettlementRegistry().settle({
                relayerPrivateKey: this.privateKey,
                preparedSettle: extra.preparedSettle,
            });

            this.nullifiers.set(extra.resourceId as Hex, nullifier);

            return {
                success: true,
                transaction: hash,
                payer: privateKeyToAccount(this.privateKey).address,
                network: this.network,
                extensions: {
                    nullifier: nullifier.toString()
                },
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
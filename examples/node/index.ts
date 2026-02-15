import { Chain, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { getEnv } from "../../src";
import { createFangornMiddleware } from "../../src/client/middleware";
import { atob } from "node:buffer";
import { FangornConfig } from "fangorn-sdk/lib/config";

const envChain = process.env.CHAIN!;
const config = envChain == "arbitrumSepolia" ? FangornConfig.ArbitrumSepolia : FangornConfig.BaseSepolia;

async function nodeExample() {

    const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as Hex);
    const resourceServerHost = getEnv("RESOURCE_SERVER_DOMAIN");
    const resourceServerPort = getEnv("SERVER_PORT");
    const pinataJwt = getEnv("PINATA_JWT");
    const pinataGateway = getEnv("PINATA_GATEWAY");

    const domain = "localhost:3000";

    const walletClient = createWalletClient({
        account,
        chain: config.chain,
        transport: http(config.rpcUrl),
    });

    const middleware = await createFangornMiddleware(
        walletClient,
        config,
        domain,
        pinataJwt,
        pinataGateway
    );

    const id = "0xb4e0ae3e26372b1f07cad47f1c6c813c991ab72e415986c074d32af7a9b019f2" as Hex;
    const tag = "test.txt";

    const result = await middleware.fetchResource({
        id,
        tag,
        baseUrl: `${resourceServerHost}:${resourceServerPort}`,
    });

    if (result.success) {
        console.log("Decrypted result:", atob(result.dataString));
        console.log("Already paid?", result.alreadyPaid);
        process.exit(0)
    } else {
        console.error("Failed:", result.error);
    }
}

await nodeExample().catch(console.error);
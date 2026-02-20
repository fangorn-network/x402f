import { createWalletClient, http, type Hex } from "viem";
import { Address, privateKeyToAccount } from "viem/accounts";
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

    // 0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6
    const owner = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6" as Address; 
    const datasourceName = "220";
    const tag = "test.txt";

    const result = await middleware.fetchResource({
        owner,
        datasourceName,
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
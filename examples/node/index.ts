import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getEnv } from "../../src";
import { configFromEnv, createFangornMiddleware } from "../../src/client/middleware";
import { atob } from "node:buffer";

async function nodeExample() {
    const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as Hex);
    const resourceServerHost = getEnv("RESOURCE_SERVER_DOMAIN");
    const resourceServerPort = getEnv("SERVER_PORT");

    const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(getEnv("CHAIN_RPC_URL")),
    });

    const middleware = await createFangornMiddleware(
        walletClient,
        configFromEnv(getEnv)
    );

    console.log("Connected as:", middleware.getAddress());

    const vaultId = "0x32d2132278f4c895b8985d90ca8e5a92feb7e9136933a50f2281dc1bc27e9231" as Hex;
    const tag = "helloFangorn.txt";

    const result = await middleware.fetchResource({ 
        vaultId,
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
import { type Hex } from "viem";
import { Address } from "viem/accounts";
import { FangornX402Middleware } from "@fangorn-network/fetch";
import { FangornConfig } from "@fangorn-network/sdk";

const getEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Environment variable ${key} is not set`);
    }
    return value;
};

const envChain = process.env.CHAIN!;
const config = envChain == "arbitrumSepolia" ? FangornConfig.ArbitrumSepolia : FangornConfig.BaseSepolia;

async function nodeExample() {

    const privateKey = getEnv("EVM_PRIVATE_KEY") as Hex;
    const resourceServerUrl = getEnv("RESOURCE_SERVER_URL");
    const domain = "localhost:3000";

    const middleware = await FangornX402Middleware.create({
        privateKey,
        config,
        usdcContractAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
        usdcDomainName: "USD Coin",
        facilitatorAddress: "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6",
        domain,
    });

    const owner = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6" as Address;
    const schemaName = "noagent-fangorn.test.music.v0";
    const tag = "test";

    const result = await middleware.fetchResource({
        privateKey,
        owner,
        schemaName,
        tag,
        baseUrl: resourceServerUrl,
    });

    if (result.success) {
        console.log("Decrypted result:", JSON.stringify(result));
        process.exit(0)
    } else {
        console.error("Failed:", result.error);
    }
}

await nodeExample().catch(console.error);

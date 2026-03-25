import { createWalletClient, http, type Hex } from "viem";
import { Address, privateKeyToAccount } from "viem/accounts";
import { atob } from "node:buffer";
import { createFangornMiddleware } from "../../packages/fetch/src/middleware.js";
import { FangornConfig, computeSchemaId } from "@fangorn-network/sdk";


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
    const pinataJwt = getEnv("PINATA_JWT");
    const pinataGateway = getEnv("PINATA_GATEWAY");

    const domain = "localhost:3000";

    const middleware = await createFangornMiddleware(
        privateKey,
        config,
        domain,
        pinataJwt,
        pinataGateway
    );

    const owner = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6" as Address;
    const schemaName = "noagent-fangorn.test.music.v0";
    const tag = "track-003";

    const result = await middleware.fetchResource({
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

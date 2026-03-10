    import { createWalletClient, http, type Hex } from "viem";
    import { Address, privateKeyToAccount } from "viem/accounts";
    import { atob } from "node:buffer";
    import { createFangornMiddleware } from "@x402f/fetch";
    import { FangornConfig } from "fangorn-sdk";


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

        const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as Hex);
        const resourceServerUrl = getEnv("RESOURCE_SERVER_URL");
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

        const owner = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6" as Address; 
        const datasourceName = "demo";
        const tag = "helloFangorn.txt";

        const result = await middleware.fetchResource({
            owner,
            datasourceName,
            tag,
            baseUrl: resourceServerUrl,
        });

        if (result.success) {
            console.log("Decrypted result:", atob((result as any).dataString));
            process.exit(0)
        } else {
            console.error("Failed:", result.error);
        }
    }

    await nodeExample().catch(console.error);
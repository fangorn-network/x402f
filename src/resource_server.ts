import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createWalletClient, http } from "viem";
import { createLitClient } from "@lit-protocol/lit-client";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { Fangorn } from "fangorn-sdk";
import { nagaDev } from "@lit-protocol/networks";

const app = express();

// Your receiving wallet address
const payTo = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6";

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
};

// Create facilitator client (testnet)
const facilitatorClient = new HTTPFacilitatorClient({
  // url: "https://x402.org/facilitator"
  url: "http://localhost:30333"
});

const rpcUrl = process.env.CHAIN_RPC_URL!;
if (!rpcUrl) throw new Error("CHAIN_RPC_URL required");

const jwt = process.env.PINATA_JWT!;
if (!jwt) throw new Error("PINATA_JWT required");

const gateway = process.env.PINATA_GATEWAY!;
if (!gateway) throw new Error("PINATA_GATEWAY required");

const delegatorAccount = privateKeyToAccount(
  getEnv("DELEGATOR_ETH_PRIVATE_KEY") as `0x${string}`,
);

const delegatorWalletClient = createWalletClient({
  account: delegatorAccount,
  transport: http(rpcUrl),
  chain: baseSepolia,
});

// Create resource server and register EVM scheme
const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);

// todo: initialize fangorn
// then we use it to load the manifest, get data, etc.
// essentially it is the 'storage adapter' 
// client to interact with LIT proto
const litClient = await createLitClient({
  network: nagaDev,
});

const domain = "localhost:3000";

const fangorn = await Fangorn.init(
  jwt,
  gateway,
  delegatorWalletClient,
  litClient,
  domain,
);


app.use(
  paymentMiddleware(
    {
      "POST /resource": {
        accepts: [
          {
            scheme: "exact",
            price: async (request) => {
              // based on vaultid/tag , we get the manifest and the price
              const { vaultId, tag, owner } = request.body;
              const vault = fangorn.getVault(vaultId);
              // find tagged data within the vault
              const cid = vault.array.forEach(element => {
                console.log(cid)
              });

              // const manigest = fangorn.getManifest(vault);

              return "$0.00001";
            },
            network: "eip155:84532", // Base Sepolia (CAIP-2 format)
            payTo,
          },
        ],
        description: "Get current weather data for any location",
        mimeType: "application/json",
      },
    },
    server,
  ),
);

// Implement your route
app.get("/resource", (req, res) => {
  console.log("Headers:", req.headers);
  res.send({
    report: {
      weather: "sunny",
      temperature: 70,
    },
  });
});

app.listen(4021, () => {
  console.log(`Server listening at http://localhost:4021`);
});
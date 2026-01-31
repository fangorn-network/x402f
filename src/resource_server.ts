import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createWalletClient, http } from "viem";
import type { Hex } from "viem";
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
  getEnv("EVM_PRIVATE_KEY") as `0x${string}`,
);

const delegatorWalletClient = createWalletClient({
  account: delegatorAccount,
  transport: http(rpcUrl),
  chain: baseSepolia,
});

// Create resource server and register EVM scheme
const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);

// lit client for fangorn... should this be optional?
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

// 2. OPTIONAL: Add a "Body Debugger" to confirm it's working
app.use((req, res, next) => {
  console.log("Pre-Payment check - Method:", req.method, "Body:", req.body);
  next();
});

app.use(
  paymentMiddleware(
    {
      "POST /resource": {
        accepts: [
          {
            scheme: "exact",
            price: async (context: HTTPRequestContext) => {
              if (!context.adapter.getBody) {
                throw new Error("Adapter does not support body parsing");
              }

              const reqBody = context.adapter.getBody();

              console.log(reqBody);
              // const entry = await fangorn.getVaultData(reqBody.vaultId, reqBody.tag);

              // console.log(`found the entry ${JSON.stringify(entry)}`)

              return "0.00001"; // Return the price string
            },
            payTo: async (context: HTTPRequestContext) => {
              // Access body the same way here
              const reqBody = context.adapter.getBody?.() as any;
              // return reqBody?.owner;
              return payTo;
            },
            network: "eip155:84532"
          }
        ],
        description: "Get current weather data for any location",
        mimeType: "application/json",
      },
    },
    server,
  ),
);

// Implement your route
app.post("/resource", (req, res) => {
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
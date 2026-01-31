import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/server";
// Remove this: import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createWalletClient, http } from "viem";
import { createLitClient } from "@lit-protocol/lit-client";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { Fangorn, computeTagCommitment } from "fangorn-sdk";
import { nagaDev } from "@lit-protocol/networks";
import { FangornEvmScheme } from "./FangornEvmScheme";  // Add this

const app = express();
app.use(express.json());

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`Environment variable ${key} is not set`);
  return value;
};

const facilitatorClient = new HTTPFacilitatorClient({
  url: "http://localhost:30333"
});

const rpcUrl = getEnv("CHAIN_RPC_URL");
const jwt = getEnv("PINATA_JWT");
const gateway = getEnv("PINATA_GATEWAY");

const delegatorAccount = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as `0x${string}`);

const delegatorWalletClient = createWalletClient({
  account: delegatorAccount,
  transport: http(rpcUrl),
  chain: baseSepolia,
});

const server = new x402ResourceServer(facilitatorClient);
server.register("eip155:*", new FangornEvmScheme());

const litClient = await createLitClient({ network: nagaDev });
const domain = "localhost:3000";

const fangorn = await Fangorn.init(jwt, gateway, delegatorWalletClient, litClient, domain);

app.use(
  paymentMiddleware(
    {
      "POST /resource": {
        description: "Accessing protected Fangorn Vault data",
        mimeType: "application/json",
        accepts: [
          {
            scheme: "exact",
            network: "eip155:84532",
            price: async (context: HTTPRequestContext) => {
              const body = context.adapter.getBody?.();
              const entry = await fangorn.getVaultData(body.vaultId, body.tag);
              const commitment = await computeTagCommitment(body.vaultId, body.tag);


              // Convert decimal price to atomic units (USDC has 6 decimals)
              const decimalPrice = parseFloat(entry.price);
              const atomicAmount = Math.round(decimalPrice * 1_000_000).toString();
              // Return AssetAmount with your extra included!
              return {
                amount: atomicAmount,
                asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
                extra: {
                  name: "USDC",
                  version: "2",
                  commitment: commitment.toString(),
                }
              };
            },
            payTo: async (context: HTTPRequestContext) => {
              const body = context.adapter.getBody?.();
              const vault = await fangorn.getVault(body.vaultId);
              return vault.owner;
            },
            maxTimeoutSeconds: 300,
          }
        ],
      },
    },
    server,
  ),
);

app.post("/resource", async (req, res) => {
  try { 
    res.send({
      success: true,
      report: { }
    });
  } catch (error: any) {
    res.status(500).send({ error: error.message });
  }
});

app.listen(4021, () => {
  console.log(`x402 V2 Resource Server listening at http://localhost:4021`);
});
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/server";
import { createWalletClient, Hex, http } from "viem";
import { createLitClient } from "@lit-protocol/lit-client";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AppConfig, Fangorn, computeTagCommitment } from "fangorn-sdk";
import { nagaDev } from "@lit-protocol/networks";
import { FangornEvmScheme } from "./FangornEvmScheme";
import { getEnv } from "..";
import { PinataSDK } from "pinata";
import { Vault } from "fangorn-sdk/lib/interface/contentRegistry";

const app = express();
app.use(express.json());

// setup
const facilitatorClient = new HTTPFacilitatorClient({
  url: "http://localhost:30333"
});

const port = getEnv("SERVER_PORT");
const rpcUrl = getEnv("CHAIN_RPC_URL");
const jwt = getEnv("PINATA_JWT");
const gateway = getEnv("PINATA_GATEWAY");

const litActionCid = getEnv("LIT_ACTION_CID");
const contentRegistryContractAddress = getEnv("CONTENT_REGISTRY_ADDR") as Hex;
const usdcContractAddress = getEnv("USDC_CONTRACT_ADDR") as Hex;

const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as `0x${string}`);

const delegatorWalletClient = createWalletClient({
  account,
  transport: http(rpcUrl),
  chain: baseSepolia,
});

const server = new x402ResourceServer(facilitatorClient);
server.register("eip155:*", new FangornEvmScheme());

const litClient = await createLitClient({ network: nagaDev });
const domain = "localhost:3000";

const config: AppConfig = {
  litActionCid,
  contentRegistryContractAddress,
  usdcContractAddress,
  chainName: "baseSepolia",
  rpcUrl,
};

// storage via Pinata
const pinata = new PinataSDK({
  pinataJwt: jwt,
  pinataGateway: gateway,
});

const fangorn = await Fangorn.init(
  delegatorWalletClient,
  pinata,
  litClient,
  domain,
  config
);

app.use(
  paymentMiddleware(
    {
      "POST /resource": {
        description: "Read fangorn data",
        mimeType: "application/json",
        accepts: [
          {
            scheme: "exact",
            network: "eip155:84532",
            price: async (context: HTTPRequestContext) => {
              const body = context.adapter.getBody?.() as any;
              const entry = await fangorn.getVaultData(body.vaultId, body.tag);
              const commitment = await computeTagCommitment(body.vaultId, body.tag);
              // Convert decimal price to atomic units (USDC has 6 decimals)
              const decimalPrice = parseFloat(entry.price);
              const atomicAmount = Math.round(decimalPrice * 1_000_000).toString();

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
              const body = context.adapter.getBody?.() as any;
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
      report: {}
    });
  } catch (error: any) {
    res.status(500).send({ error: error.message });
  }
});

app.get("/manifest/:vaultId", async (req, res) => {
  const vault: Vault = await fangorn.getVault(req.params.vaultId);
  const manifest = await fangorn.fetchManifest(vault.manifestCid);
  res.json(manifest);
});

app.listen(port, () => {
  console.log(`x402 V2 Resource Server listening at http://localhost:${port}`);
});

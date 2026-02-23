import express from "express";
import cors from 'cors';
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/server";
import { createWalletClient, Hex, http, parseUnits } from "viem";
import { createLitClient } from "@lit-protocol/lit-client";
import { privateKeyToAccount } from "viem/accounts";
import { Fangorn, LitEncryptionService, PinataStorage } from "fangorn-sdk";
import { nagaDev } from "@lit-protocol/networks";
import { FangornEvmScheme } from "./FangornEvmScheme.js";
import { getEnv } from "../index.js";
import { PinataSDK } from "pinata";
import { FangornConfig } from "fangorn-sdk/lib/config.js";
import { computeTagCommitment } from "fangorn-sdk/lib/utils/index.js";

const app = express();

// // for browser support
// app.use((req, res, next) => {
//   res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
//   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Payment');
//   res.setHeader('Access-Control-Expose-Headers', 'Payment, X-Payment-Response');
//   if (req.method === 'OPTIONS') {
//     res.sendStatus(204);
//     return;
//   }
//   next();
// });

// Note: must register this BEFORE express
app.use(cors({
  origin: 'http://localhost:5173',
  exposedHeaders: ['payment-required', 'payment-response']
}));

app.use(express.json());

// setup
// TOOO: read port from env vars
const facilitatorClient = new HTTPFacilitatorClient({
  url: "http://localhost:30333"
});

const usdcDomainName = process.env.USDC_DOMAIN_NAME!;

const config = process.env.CHAIN! === FangornConfig.ArbitrumSepolia.chainName ?
  FangornConfig.ArbitrumSepolia : FangornConfig.BaseSepolia;

const port = getEnv("SERVER_PORT");
const jwt = getEnv("PINATA_JWT");
const gateway = getEnv("PINATA_GATEWAY");
const usdcContractAddress = getEnv("USDC_CONTRACT_ADDR");
const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as `0x${string}`);

const agentCard = {
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "defaultInputModes": [
    "text/plain",
    "application/json"
  ],
  "defaultOutputModes": [
    "text/plain",
    "application/json"
  ],
  "skills": [
    {
      "id": "obtain-test-text-data",
      "name": "Obtain test text data",
      "description": "This advertises that this agent serves test text data via a resource server",
      "tags": [
        "test",
        "text",
        "x402f",
        "datasource"
      ]
    }
  ],
  "name": "local-testfile-agent",
  "description": "This is the best datasource agent for receiving test text files",
  "version": "0.0.1",
  "url": "http://localhost:4021",
  "provider": {
    "organization": "Fangorn",
    "url": "https://fangorn.network"
  }
}

const delegatorWalletClient = createWalletClient({
  account,
  transport: http(config.rpcUrl),
  chain: config.chain,
});

const server = new x402ResourceServer(facilitatorClient);
server.register("eip155:*", new FangornEvmScheme());

const litClient = await createLitClient({ network: nagaDev });
const encryptionService = new LitEncryptionService(litClient, {
  chainName: config.chainName,
});

const domain = "localhost:3000";

// storage via Pinata
const pinata = new PinataSDK({
  pinataJwt: jwt,
  pinataGateway: gateway,
});

const storage = new PinataStorage(pinata);

const fangorn = await Fangorn.init(
  delegatorWalletClient,
  storage,
  encryptionService,
  domain,
  config,
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
            network: `eip155:${config.caip2}`,
            price: async (context: HTTPRequestContext) => {
              const body = context.adapter.getBody?.() as any;
              const entry = await fangorn.getDataSourceData(body.owner, body.name, body.tag);
              // extract the price from the predicate descriptor
              const price = entry.gadgetDescriptor.params!.price as string;
              const commitment = await computeTagCommitment(body.owner, body.name, body.tag, price);
              // convert decimal price to atomic units (USDC has 6 decimals)
              const decimalPrice = parseFloat(price);
              const amount = Math.round(decimalPrice * 1_000_000).toString();

              return {
                amount,
                asset: usdcContractAddress,
                extra: {
                  name: usdcDomainName,
                  version: "2",
                  commitment: commitment.toString(),
                }
              };
            },
            payTo: async (context: HTTPRequestContext) => {
              const body = context.adapter.getBody?.() as any;
              const vault = await fangorn.getDataSource(body.owner, body.name);
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

app.get("/.well-known/agent-card.json", async (req, res) => {
  res.status(200).json(agentCard);

})

app.listen(port, () => {
  function printStartupHeader(port = "3000") {
    const header = `
  ╔═══════════════════════════════════════════════╗
  ║                                               ║
  ║   ▀▄▀ █░█ █▀█ ▀█ █▀▀   RESOURCE SERVER        ║
  ║   █░█ ▀▀█ █▄█ █▄ █▀    ═══════════════════    ║
  ║                                               ║
  ╚═══════════════════════════════════════════════╝
  
    * LISTENING ON PORT: ${port}                                 
`;

    console.log(header)
  }

  printStartupHeader(port)
});

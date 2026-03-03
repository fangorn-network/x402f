import express from 'express';
import cors from 'cors';
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/server";
import { createWalletClient, http } from "viem";
import { Address, privateKeyToAccount } from "viem/accounts";
import { computeTagCommitment, Fangorn, FangornConfig, LitEncryptionService, PinataStorage } from "fangorn-sdk";
import { FangornEvmScheme } from "./FangornEvmScheme.js";

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
};

const facilitatorHost = process.env.FACILITATOR_DOMAIN || '';
const facilitatorPort = process.env.FACILITATOR_PORT || 0;
const usdcDomainName = process.env.USDC_DOMAIN_NAME!;
const port = parseInt(process.env.SERVER_PORT!) || 0;
const jwt = getEnv("PINATA_JWT");
const gateway = getEnv("PINATA_GATEWAY");
const usdcContractAddress = getEnv("USDC_CONTRACT_ADDR");
const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as `0x${string}`);

console.log(`facilitatorHost:Port=${facilitatorHost}:${facilitatorPort}`);

// the fangorn config derived from chain
const config = process.env.CHAIN! === FangornConfig.ArbitrumSepolia.chainName ?
  FangornConfig.ArbitrumSepolia : FangornConfig.BaseSepolia;

const app = express();

// Note: must register this BEFORE express
// app.use(cors({
//   origin: 'http://localhost:5173',
//   exposedHeaders: ['payment-required', 'payment-response'],
//   methods: ['GET'], 
// }));
app.use(cors({
  origin: '*', // For testing, allow all
  exposedHeaders: ['payment-required', 'payment-response', 'x402-commitment'],
  methods: ['GET', 'POST', 'OPTIONS'], 
}));
// app.use(cors());

app.use(express.json());

// setup
// TOOO: read port from env vars
const facilitatorClient = new HTTPFacilitatorClient({
  url: `${facilitatorHost}:${facilitatorPort}`
});


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

const encryptionService = await LitEncryptionService.init(config.chainName);

// TODO: is this right?
// const domain = `0.0.0.0:${port}`;
const domain = process.env.RESOURCE_SERVER_DOMAIN || `localhost:${port}`;

// storage via Pinata
const storage = new PinataStorage(jwt, gateway);

const fangorn = await Fangorn.init(
  delegatorWalletClient,
  storage,
  encryptionService,
  domain,
  config,
);

console.log('using usdc domain name ' + usdcDomainName);

const resolveParam = (val: string | string[] | undefined): string => {
  const raw = Array.isArray(val) ? val[0] : val ?? "";
  return raw.trim();
};

app.use(
  paymentMiddleware(
    {
      "GET /": {
        description: "Read fangorn data",
        mimeType: "application/json",
        accepts: [
          {
            scheme: "exact",
            network: `eip155:${config.caip2}`,
            price: async (context: HTTPRequestContext) => {
              const owner = resolveParam(context.adapter.getQueryParam?.("owner")) as Address;
              const name = resolveParam(context.adapter.getQueryParam?.("name")).trim();
              const tag = resolveParam(context.adapter.getQueryParam?.("tag")).trim();

              const entry = await fangorn.getDataSourceData(owner, name, tag);
              const price = entry.gadgetDescriptor.params!.price as string;
              const commitment = await computeTagCommitment(owner, name, tag, price);
              const amount = Math.round(parseFloat(price) * 1_000_000).toString();

              return {
                amount,
                asset: usdcContractAddress,
                extra: { name: usdcDomainName, version: "2", commitment: commitment.toString() }
              };
            },
            payTo: async (context: HTTPRequestContext) => {
              const { owner, name } = context.adapter.getQueryParams?.() as any;
              const vault = await fangorn.getDataSource(owner, name);
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

app.get("/", async (req, res: any) => {
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

app.listen(port, '0.0.0.0', () => {
  function printStartupHeader(port = 4321) {
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

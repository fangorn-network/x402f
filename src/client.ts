import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/server";
import { createWalletClient, http } from "viem";
import type { Hex } from "viem";
import { createLitClient } from "@lit-protocol/lit-client";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { Fangorn } from "fangorn-sdk";
import { nagaDev } from "@lit-protocol/networks";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { takeCoverage } from "node:v8";


const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
};

// setup
// Create signer
const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as Hex);

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


// if (true) {
// step 1. add data to fangorn (merchant)
const vaultName = "client-vault-test-5";
// create vault
const vaultId = await fangorn.createVault(vaultName);
// add data
const tag = "test0";
const price = "0.000001";
// build manifest
const manifest = [
  {
    tag,
    data: "content0",
    extension: ".txt",
    fileType: "text/plain",
    price,
  },
];
await fangorn.upload(vaultId, manifest);
// }
// step 2. purchase data (buyer/agent)

// Create x402 client and register EVM scheme
const client = new x402Client();
registerExactEvmScheme(client, { signer });

// Wrap fetch with payment handling
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Make request - payment is handled automatically
const response = await fetchWithPayment("http://127.0.0.1:4021/resource", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    vaultId,
    tag,
    owner: signer.address, // we are purchasing our own data here
  }),
});

const data = await response.json();
console.log("Response:", data);

if (response.status === 402) {
  console.warn("Client stopped at 402. Check these headers:");
  console.log("X-402-Payment-Required:", response.headers);
}

// Get payment receipt from response headers
if (response.ok) {
  const httpClient = new x402HTTPClient(client);
  const paymentResponse = httpClient.getPaymentSettleResponse(
    (name: string) => response.headers.get(name)
  );
  console.log("Payment settled:", paymentResponse);
}
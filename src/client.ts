import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createLitClient } from "@lit-protocol/lit-client";
import { nagaDev } from "@lit-protocol/networks";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { Fangorn } from "fangorn-sdk";
import { getEnv } from ".";

// Setup

const rpcUrl = getEnv("CHAIN_RPC_URL");
const jwt = getEnv("PINATA_JWT");
const gateway = getEnv("PINATA_GATEWAY");

const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as Hex);

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(rpcUrl),
});

const litClient = await createLitClient({
  network: nagaDev,
});

const domain = "localhost:3000";

const fangorn = await Fangorn.init(jwt, gateway, walletClient, litClient, domain);

// Step 1 Upload data to Fangorn (merchant)

// uncomment to create a new vault
// const vaultName = "client-vault-test-6";
// const vaultId = await fangorn.createVault(vaultName);
// note: vaultIds can be easily derived, it's just sha256(name || owner_adress)
const vaultId = "0xfffaa53aa36eb568d3a7d82c8f9a2ba7d6f09968531143bc6727c307cd9b1516";

const tag = "test1";
const price = "0.000001";

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

// Step 2: purchase data

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const response = await fetchWithPayment("http://127.0.0.1:4021/resource", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ vaultId, tag }),
});

const data = await response.json();
console.log("Response:", data);

if (response.status === 402) {
  console.warn("Client stopped at 402. Check these headers:");
  console.log("X-402-Payment-Required:", response.headers);
}

if (response.ok) {
  const httpClient = new x402HTTPClient(client);
  const paymentResponse = httpClient.getPaymentSettleResponse(
    (name: string) => response.headers.get(name)
  );
  console.log("Payment settled:", paymentResponse);

  console.log("Attempting to decrypt...");
  const result = await fangorn.decryptFile(vaultId, tag);
  const outputAsString = new TextDecoder().decode(result);
  console.log(`Decrypted result: ${outputAsString}`);
}
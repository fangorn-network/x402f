import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createLitClient } from "@lit-protocol/lit-client";
import { nagaDev } from "@lit-protocol/networks";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { AppConfig, Fangorn } from "fangorn-sdk";
import { getEnv } from ".";

// Setup
const rpcUrl = getEnv("CHAIN_RPC_URL");
const jwt = getEnv("PINATA_JWT");
const gateway = getEnv("PINATA_GATEWAY");

const litActionCid = getEnv("LIT_ACTION_CID");
const contentRegistryContractAddress = getEnv("CONTENT_REGISTRY_ADDR") as Hex;
const usdcContractAddress = getEnv("USDC_CONTRACT_ADDR") as Hex;

const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as Hex);
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(rpcUrl),
});

const litClient = await createLitClient({
  network: nagaDev,
});

console.log("lit client ready!");

const domain = "localhost:3000";
const config: AppConfig = {
  litActionCid: litActionCid,
  // circuitJsonCid: circuitJsonCid,
  contentRegistryContractAddress,
  usdcContractAddress,
  chainName: "baseSepolia",
  rpcUrl: rpcUrl,
};

const fangorn = await Fangorn.init(jwt, gateway, walletClient, litClient, domain, config);

// Step 1 Upload data to Fangorn (merchant)

// uncomment to create a new vault
// const vaultName = "2.2.2026 4:22PM GMT-6";
// const vaultId = await fangorn.createVault(vaultName);
// console.log(vaultId)
// note: vaultIds can be easily derived, it's just sha256(name || owner_adress)
const vaultId = "0xefd10c2a95ffd867b3b16a0cf2733956e0c2ad4226d3de056b43d558fa768e02";
const tag = "test0";
// const price = "0.000001";

// const fileData = [
//   {
//     tag,
//     data: "{temp: 100, unit: c, time: 00:00 UTC}",
//     extension: ".txt",
//     fileType: "text/plain",
//     price,
//   },
// ];

// await fangorn.upload(vaultId, fileData);

// // wait to make sure pinata is behaving
// await new Promise((resolve) => setTimeout(resolve, 10_000));

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
// console.log(data.details);

let alreadyPaid = false;

if (data.details) {
  alreadyPaid = data.details.includes("Already paid");
  console.log('already paid? ' + alreadyPaid);
}

if (response.status === 402) {
  console.warn("Client stopped at 402. Check these headers:");
  console.log("X-402-Payment-Required:", response.headers);
}

if (response.ok || alreadyPaid) {
  // const httpClient = new x402HTTPClient(client);
  // const paymentResponse = httpClient.getPaymentSettleResponse(
  //   (name: string) => response.headers.get(name)
  // );
  // console.log("Payment settled:", paymentResponse); 

  console.log("Attempting to decrypt...");
  const result = await fangorn.decryptFile(vaultId, tag);
  const outputAsString = new TextDecoder().decode(result);
  console.log(`Decrypted result: ${outputAsString}`);
}
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { Hex } from "viem";

// Create signer
const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as Hex);

// step 1. add data to fangorn (merchant)


// step 2. purchase data (buyer/agent)

// Create x402 client and register EVM scheme
const client = new x402Client();
registerExactEvmScheme(client, { signer });

// Wrap fetch with payment handling
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Make request - payment is handled automatically
const response = await fetchWithPayment("http://127.0.0.1:4021/weather", {
  method: "GET",
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
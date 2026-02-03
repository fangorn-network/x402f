import { getEnv } from "../index.js";
import { createFangornMiddleware, configFromEnv } from "./middleware.js";
import type { Hex } from "viem";

// ─────────────────────────────────────────────────────────────────────────────
// Example Usage
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // Option 1: Create middleware from environment variables
  const middleware = await createFangornMiddleware(configFromEnv(getEnv));

  // Option 2: Create with explicit config
  // const middleware = await createFangornMiddleware({
  //   rpcUrl: "https://sepolia.base.org",
  //   pinataJwt: "your-jwt",
  //   pinataGateway: "your-gateway",
  //   litActionCid: "your-cid",
  //   contentRegistryContractAddress: "0x...",
  //   usdcContractAddress: "0x...",
  //   privateKey: "0x...",
  // });

  console.log("Middleware initialized!");

  // ─────────────────────────────────────────────────────────────────────────
  // Fetch and decrypt a resource (handles payment automatically)
  // ─────────────────────────────────────────────────────────────────────────

  const vaultId = "0x42d10309dee5509f76d05155b59fef8a1fd9e9d71983c8e073a9301d3c0911f5" as Hex;
  const tag = "test.txt";

  const result = await middleware.fetchResource({
    vaultId,
    tag,
    baseUrl: "http://127.0.0.1:4021",
  });

  if (result.success) {
    console.log("Decrypted result:", result.dataString);
    console.log("Already paid?", result.alreadyPaid);
    if (result.paymentResponse) {
      console.log("Payment settled:", result.paymentResponse);
    }
  } else {
    console.error("Failed:", result.error);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Create a vault and upload content (merchant flow)
  // ─────────────────────────────────────────────────────────────────────────

  // const vaultName = "2.2.2026 4:22PM GMT-6";
  // const newVaultId = await middleware.createVault(vaultName);
  // console.log("Created vault:", newVaultId);

  // const price = "0.000001";
  // await middleware.upload(newVaultId, [
  //   {
  //     tag: "sensor-data.txt",
  //     data: "{temp: 100, unit: c, time: 00:00 UTC}",
  //     extension: ".txt",
  //     fileType: "text/plain",
  //     price,
  //   },
  // ]);

  // // Wait for Pinata propagation
  // await new Promise((resolve) => setTimeout(resolve, 10_000));

  // ─────────────────────────────────────────────────────────────────────────
  // Advanced: Use the payment-wrapped fetch directly
  // ─────────────────────────────────────────────────────────────────────────

  // const paymentFetch = middleware.getPaymentFetch();
  // const response = await paymentFetch("http://127.0.0.1:4021/custom-endpoint", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ /* custom payload */ }),
  // });
}

main().catch(console.error);
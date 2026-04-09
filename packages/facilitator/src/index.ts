import { SettleResponse, VerifyResponse } from "@x402/core/types";
import { PaymentPayload, PaymentRequirements } from "@x402/fetch";
import express from "express";
import morgan from "morgan";
import { getFacilitator } from "./facilitator.js";

// Initialize Express app
const app = express();

app.use(morgan('combined'))
app.use(express.json());

/**
 * POST /verify
 * Verify a payment against requirements
 *
 * Note: Payment tracking and bazaar discovery are handled by lifecycle hooks
 */
app.post("/verify", async (req, res) => {

  try {
    const facilitator = await getFacilitator();
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    // Hooks will automatically:
    // - Track verified payment (onAfterVerify)
    // - Extract and catalog discovery info (onAfterVerify)
    const response: VerifyResponse = await facilitator.verify(
      paymentPayload,
      paymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /settle
 * Settle a payment on-chain
 *
 * Note: Verification validation and cleanup are handled by lifecycle hooks
 */
app.post("/settle", async (req, res) => {
  try {
    const facilitator = await getFacilitator();
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    // Hooks will automatically:
    // - Validate payment was verified (onBeforeSettle - will abort if not)
    // - Check verification timeout (onBeforeSettle)
    // - Clean up tracking (onAfterSettle / onSettleFailure)
    const response: SettleResponse = await facilitator.settle(
      paymentPayload as PaymentPayload,
      paymentRequirements as PaymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);

    // Check if this was an abort from hook
    if (
      error instanceof Error &&
      error.message.includes("Settlement aborted:")
    ) {
      // Return a proper SettleResponse instead of 500 error
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      } as SettleResponse);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /supported
 * Get supported payment kinds and extensions
 */
app.get("/supported", async (req, res) => {
  try {
    const facilitator = await getFacilitator();
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// TODO: make this configurable
app.get('/fee', (req, res) => {
    res.json({ feePercent: 2.5 })
})

const port = parseInt(process.env.FACILITATOR_PORT!) || 0;

// Start the server
app.listen(port, '0.0.0.0', () => {
  function printStartupHeader(port = 30333) {
    const header = `
  ╔═══════════════════════════════════════════════╗
  ║                                               ║
  ║   ▀▄▀ █░█ █▀█ ▀█ █▀▀   FACILITATOR            ║
  ║   █░█ ▀▀█ █▄█ █▄ █▀    ═══════════════════    ║
  ║                                               ║
  ╚═══════════════════════════════════════════════╝
  
    * LISTENING ON PORT: ${port}                               
`;

    console.log(header)
  }

  printStartupHeader(port)
});
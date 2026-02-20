import { beforeAll, describe, it, expect } from "vitest";
import { Account, createWalletClient, Hex, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join } from "path";
// import { deployContract } from "./deployContract.js";
// import { TestBed } from "./test/testbed.js";
// import { uploadToPinata } from "./test/index.js";
import { createRequire } from "module";
import { baseSepolia } from "viem/chains";

const getEnv = (key: string) => {
	const value = process.env[key];
	if (!value) {
		throw new Error(`Environment variable ${key} is not set`);
	}
	return value;
};

describe("x402f e2e test", () => {

	beforeAll(async () => {

	}, 120_000); // 2 minute timeout

	// afterall => cleanup (unpin files)
	it("should succeed to decrypt when the payment is settled", async () => {
		// start facilitator
		
		// start server

		// publish data

		// run client example	
		
    });
});

import express from 'express';
import cors from 'cors';
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/server";
import { createWalletClient, http } from "viem";
import { Address, privateKeyToAccount } from "viem/accounts";
import { Fangorn, FangornConfig, LitEncryptionService, PinataStorage } from "@fangorn-network/sdk";
import { FangornEvmScheme } from "./FangornEvmScheme.js";
import { GoogleAuth } from 'google-auth-library';
import { Hex } from "viem";
import { SettlementRegistry } from '@fangorn-network/sdk/lib/registries/settlement-registry/index.js';

const getEnv = (key: string): string => {
	const value = process.env[key];
	if (!value) throw new Error(`Environment variable ${key} is not set`);
	return value;
};

const facilitatorUrl = process.env.FACILITATOR_URL || '';
const usdcDomainName = getEnv("USDC_DOMAIN_NAME");
const port = parseInt(process.env.SERVER_PORT!) || 0;
const jwt = getEnv("PINATA_JWT");
const gateway = getEnv("PINATA_GATEWAY");
const usdcContractAddress = getEnv("USDC_CONTRACT_ADDR");
const privateKey = getEnv("EVM_PRIVATE_KEY") as `0x${string}`;
const account = privateKeyToAccount(privateKey);
const gcpAuth = getEnv("GCP_AUTH");

console.log(`facilitatorUrl=${facilitatorUrl}`);

const config = process.env.CHAIN! === FangornConfig.ArbitrumSepolia.chainName
	? FangornConfig.ArbitrumSepolia
	: FangornConfig.BaseSepolia;

const app = express();

app.use(cors({
	origin: '*',
	exposedHeaders: ['payment-required', 'payment-response', 'x402-commitment'],
	methods: ['GET', 'POST', 'OPTIONS'],
}));

app.use(express.json());

const auth = new GoogleAuth();

async function getAuthHeaders() {
	let token = '';
	if (gcpAuth === "true") {
		const client = await auth.getIdTokenClient(facilitatorUrl);
		token = await client.idTokenProvider.fetchIdToken(facilitatorUrl);
	}
	const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
	return { verify: headers, settle: headers, supported: headers };
}

const facilitatorClient = new HTTPFacilitatorClient({
	url: facilitatorUrl,
	createAuthHeaders: getAuthHeaders,
});

const agentCard = {
	capabilities: {
		streaming: false,
		pushNotifications: false,
		stateTransitionHistory: false,
	},
	defaultInputModes: ["text/plain", "application/json"],
	defaultOutputModes: ["text/plain", "application/json"],
	skills: [
		{
			id: "obtain-test-text-data",
			name: "Obtain test text data",
			description: "Serves test text data via a Fangorn resource server",
			tags: ["test", "text", "x402f", "datasource"],
		},
	],
	name: "local-testfile-agent",
	description: "Fangorn datasource agent for test text files",
	version: "0.0.1",
	// TODO
	url: `http://localhost:${port}`,
	provider: {
		organization: "Fangorn",
		url: "https://fangorn.network",
	},
};

const delegatorWalletClient = createWalletClient({
	account,
	transport: http(config.rpcUrl),
	chain: config.chain,
});

const server = new x402ResourceServer(facilitatorClient);
server.register("eip155:*", new FangornEvmScheme());

// const encryptionService = await LitEncryptionService.init(config.chainName);
// const domain = process.env.RESOURCE_SERVER_DOMAIN || `localhost:${port}`;
// const storage = new PinataStorage(jwt, gateway);

const fangorn = await Fangorn.create({
	privateKey,
	storage: {
		pinata: { jwt, gateway }
	},
	encryption: { lit: true },
	config,
	domain: "localhost"
});

const resolveParam = (val: string | string[] | undefined): string =>
	(Array.isArray(val) ? val[0] : val ?? "").trim();

// extract and validate query params
function resolveEntryParams(context: HTTPRequestContext): {
	owner: Address;
	schemaId: Hex;
	tag: string;
} {
	const owner = resolveParam(context.adapter.getQueryParam?.("owner")) as Address;
	const schemaId = resolveParam(context.adapter.getQueryParam?.("schemaId")) as Hex;
	const tag = resolveParam(context.adapter.getQueryParam?.("tag"));

	if (!owner) throw new Error("Missing query param: owner");
	if (!schemaId || schemaId === "0x") throw new Error("Missing query param: schemaId");
	if (!tag) throw new Error("Missing query param: tag");

	return { owner, schemaId, tag };
}

app.use(
	paymentMiddleware(
		{
			"GET /": {
				description: "Read Fangorn encrypted data",
				mimeType: "application/json",
				accepts: [
					{
						scheme: "exact",
						network: `eip155:${config.caip2}`,

						price: async (context: HTTPRequestContext) => {
							const { owner, schemaId, tag } = resolveEntryParams(context);
							const resourceId = SettlementRegistry.deriveResourceId(owner, schemaId, tag);
							const price = await fangorn.getSettlementRegistry().getPrice(resourceId);
							const amount = price.toString();

							return {
								amount,
								asset: usdcContractAddress,
								extra: {
									name: usdcDomainName,
									version: "2",
									commitment: resourceId,
								},
							};
						},
						payTo: async (context: HTTPRequestContext) => {
							// payTo is the address that receives payment — always the resource server's account
							return account.address;
						},

						maxTimeoutSeconds: 300,
					},
				],
			},
		},
		server,
	),
);

// GET '/' - returns a 200 when conditions are verified (e.g. payment settled)
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


// Agent card
app.get("/.well-known/agent-card.json", (_req, res) => {
	res.status(200).json(agentCard);
});

app.listen(port, '0.0.0.0', () => {
	console.log(`
  ╔═══════════════════════════════════════════════╗
  ║                                               ║
  ║   ▀▄▀ █░█ █▀█ ▀█ █▀▀   RESOURCE SERVER        ║
  ║   █░█ ▀▀█ █▄█ █▄ █▀    ═══════════════════    ║
  ║                                               ║
  ╚═══════════════════════════════════════════════╝

    * LISTENING ON PORT: ${port}
  `);
});
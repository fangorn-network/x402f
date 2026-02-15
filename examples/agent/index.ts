import { ChatGroq } from "@langchain/groq";
import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { createAgent } from "langchain";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getEnv } from "../../src";
import { configFromEnv, createFangornMiddleware } from "../../src/client/middleware";
import express from 'express';

const app = express();
const PORT = 3000;

// Add JSON body parser middleware
app.use(express.json());

async function main() {
  console.log("creating middleware");
  const account = privateKeyToAccount(getEnv("EVM_PRIVATE_KEY") as Hex);
  const resourceServerHost = getEnv("RESOURCE_SERVER_DOMAIN");
  const resourceServerPort = getEnv("SERVER_PORT");
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(getEnv("CHAIN_RPC_URL")),
  });
  
  const middleware = await createFangornMiddleware(
    walletClient,
    configFromEnv(getEnv)
  );
  console.log("Connected as:", middleware.getAddress());
  
  const vaultId = "0x32d2132278f4c895b8985d90ca8e5a92feb7e9136933a50f2281dc1bc27e9231" as Hex;
  const tag = "helloFangorn.txt";

  console.log("creating agent");

  const queryEndpoint = tool(
    async () => {
      const result = await middleware.fetchResource({
        vaultId,
        tag,
        baseUrl: `${resourceServerHost}:${resourceServerPort}`,
      });
      result.dataString = atob(result.dataString)
      console.log("response: ", result);
      const json = JSON.stringify(result);
      console.log("json: ", json);
      return json;
    },
    {
      name: "query_endpoint",
      description: "An endpoint that will return data in a JSON format",
      schema: z.object({}),
    }
  );

  const systemPrompt = `You are my AI agent.

    You have access to one tool:
  
    - query_endpoint: an endpoint that will return data in a JSON format
  
    When you receive a message from the user:
    1. Call the query_endpoint tool
    2. Look at the JSON data returned by the tool
    3. In your response, say "I'm a whacky lil bot!" AND include the full JSON data you received
  
    You MUST include the actual data from the tool in your response. Do not just acknowledge it.`;

  const model = new ChatGroq({
    model: "llama-3.3-70b-versatile"
  });

  const agent = createAgent({
    model,
    tools: [queryEndpoint],
  });

  async function invokeAgent() {
    console.log("invoking agent...");

    const result = await agent.invoke({
      messages: [
        new SystemMessage(systemPrompt),
        new HumanMessage("Please query the endpoint and tell me what you find."),
      ],
    });

    console.log("agent invoked and completed")

    console.log(result);
    return result;
  }

  // POST endpoint - accepts JSON and echoes it back
  app.post('/agent', async (req, res) => {
    try {
      const receivedData = req.body;
      const agentResult = await invokeAgent();

    const aiMessages = agentResult.messages.filter(
      (msg) => msg instanceof AIMessage && msg.content && !msg.tool_calls?.length
    );
    const agentResponse = aiMessages[aiMessages.length - 1]?.content;

      res.json({
        success: true,
        message: 'Data received successfully',
        received: receivedData,
        agentResponse,
      });
    } catch (error) {
      console.error("Agent error:", error);
      res.status(500).json({
        success: false,
        message: 'Agent invocation failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

main().catch(console.error);
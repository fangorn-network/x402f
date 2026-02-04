# A simple AI agent sitting on an Express JS server.

#### To run:
0. Ensure that you have a Groq API key and it is set in your .env file, you have the facilitator running, and you have the resource server running.
1. In examples/agent run ```npm i```
2. From the root of the x402 project run ```npm run client:agent```
3. From a different terminal window run ```curl -X POST http://localhost:3000/agent   -H "Content-Type: application/json"   -d '{}'```
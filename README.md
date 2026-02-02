# x402f 

## Setup

First setup environment variables by running `cp .env.local .env` and filling in the details.

## Start the Facilitator

`npm run facilitator`

## start the server

`npm run server`

## run the client example

install tsx  with `npm install -D tsx`

Then run the example with

`npm run client`

The example 


https://github.com/coinbase/x402/blob/main/docs/getting-started/quickstart-for-sellers.mdx

https://github.com/coinbase/x402/tree/b8fcea79b06b19fb20874d6fde7cef1df20af6f0/typescript/packages/core

https://github.com/coinbase/x402/blob/0db3e2953e8921d8cb14386baa458449f67f1bd3/typescript/site/CHANGELOG-v2.md?plain=1#L1


brainstorming...

https://dev.to/hammertoe/making-services-discoverable-with-erc-8004-trustless-agent-registration-with-filecoin-pin-1al3


We could use agent cards for data/vault discovery

- each vault is like it's own MCP server?
- we register each vault's agent card as an ERC-8004 service to make it discoverable
  - over time, the merchant earns an on-chain reputation

``` json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Dallas Weather Terminal",
  "description": "Real-time weather readings from downtown Dallas",
  "endpoints": [
    {
      "name": "fangorn",
      "endpoint": "https://prod.fangorn.network.com/resource",
      "vaultId": "0x0123abc",
      "tags": ["temperature", "humidity", "pressure"]
    }
  ],
  "metadata": {
    "location": { "lat": 32.7767, "lon": -96.7970 },
    "updateFrequency": "5min",
    "pricePerRead": "0.0001 USDC"
  },
  "supportedTrust": ["reputation"]
}
```
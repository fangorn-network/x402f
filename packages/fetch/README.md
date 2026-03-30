# x402f fetch

The package allows callers to pay for data secured with Fangorn using x402f's trust-minimized payment rails. Using x402f fetch allows callers to achieve **private purchases** and **private retrieval** of data, with **no linkage** between buyer identity and resource stored onchain. 

A wrapper around x402/fetch that:
- calls the x402f access control server
- decrypts results using [fangorn](https://github.com/fangorn-network/fangorn)

## Installation

Install the package from npm (using pnpm):

``` sh
pnpm i @fangorn-network/fetch
```

## Build

To build the package locally:
1. install deps from the root by running `pnpm i`
2. Build with `pnpm build`
   
## Usage

For a full example, see the [node example](../../examples/node/).

### Quickstart
0. Ensure an x402f facilitator is running and fetch it's public key (e.g. `0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6`).

1. Setup the middleware
``` js
const privateKey = getEnv("EVM_PRIVATE_KEY") as Hex;
const resourceServerUrl = getEnv("RESOURCE_SERVER_URL");
const domain = "localhost";

const middleware = await FangornX402Middleware.create({
    privateKey,
    config,
    usdcContractAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    usdcDomainName: "USD Coin",
    facilitatorAddress: "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6",
    domain,
});
```

2. Fetch resources
``` js
// a resource is identified by (owner, schemaName, tag)
const owner = "0x147c24c5Ea2f1EE1ac42AD16820De23bBba45Ef6" as Address;
const schemaName = "noagent-fangorn.test.music.v0";
const tag = "test";

// the caller must have sufficient balance in order to unlock access to the resource
const result = await middleware.fetchResource({
    privateKey,
    owner,
    schemaName,
    tag,
    baseUrl: resourceServerUrl,
});

// decrypt on success
if (result.success) {
    console.log("Decrypted result:", JSON.stringify(result));
    process.exit(0)
} else {
    console.error("Failed:", result.error);
}
```

# x402f fetch

Pay for Fangorn-secured data and read it back, with **no on-chain link between
the buyer and the resource they read**. The wallet that pays and the address the
access gate sees are different addresses, and nothing on-chain connects them.

The buyer's whole path is one call:

```
getUri/getPrice/getOwner/isDisabled   what am I buying, from whom
POST /verify → register(…)            pay the owner, join the resource's group
POST /settle → settle(…)              prove membership anonymously
POST /access                          the worker releases the DEK → decrypt
```

The buyer's wallet only signs. The [x402f facilitator](../facilitator) relays
both writes and pays the gas, so the stealth identity never needs funding.

## Installation

```sh
pnpm i @fangorn-network/fetch
```

## Usage

```ts
import { FangornX402Middleware } from "@fangorn-network/fetch";
import { arbitrumSepolia } from "viem/chains";

const middleware = await FangornX402Middleware.create({
    walletClient,                 // the buyer's wallet; signs, never pays gas
    chain: arbitrumSepolia,
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    registryAddress: "0x…",       // SettlementRegistry
    usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    facilitatorUrl: "http://localhost:30333",
});

// Identify the resource directly, or the way its publisher does — the registry
// derives resourceId = keccak(publisher ++ uid).
const result = await middleware.fetchResource({ publisher, uid });

if (result.success) {
    console.log(new TextDecoder().decode(result.data));   // plaintext
} else {
    console.error(result.error);
}
```

`fetchResource` reads the worker URL and the expected plaintext hash from the
resource's on-chain uri, and throws if the bytes it decrypts do not match that
hash — a worker cannot serve something else.

### Paying only once

A resource this identity has already settled is **not paid for again**. The
settlement is permanent on-chain and the nullifier that unlocks the worker is
recomputable from the identity (`poseidon2([hash(resourceId), secret])`), so a
wiped cache costs one RPC read, not another purchase. The result reports which
path ran:

```ts
const { alreadySettled, nullifier } = await middleware.fetchResource({ resourceId });
```

### Free resources

A resource priced at 0 still registers — that is how the identity joins the
resource's group — but nothing is transferred and no authorization is signed.

## Exports

Beyond the middleware, the primitives it is built from are public, for callers
who want to drive the steps themselves:

- `deriveBuyer`, `signTransferAuth`, `buildSettleProof`, `nullifierFor`, `resourceIdOf`
- `downloadAndDecrypt`, `accessMessageHash`, `unpackUri`, `sha256Hex`

Publishing (encrypt, upload, `createResource`) is deliberately **not** here — it
needs the publisher's storage credentials. See the
[node example](../../examples/node/) for that side.

## Build

1. Install deps from the repo root: `pnpm i`
2. `pnpm build`

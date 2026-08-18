# Node Example — paid content sale, end-to-end

A single self-contained script (`index.ts`) that sells one piece of encrypted
content and buys it back through the **x402f facilitator**, proving the whole
private-payment loop works:

```
SELL   encrypt → upload {ciphertext, sealed DEK} to the access worker
       createResource(uid, price, uri)                            [owner, on-chain]
       → resourceId = keccak(owner ++ uid), with its own Semaphore group

BUY    middleware.fetchResource({ publisher, uid })                [buyer]
       ├─ sign EIP-3009 authorization paying the owner the price
       ├─ POST /verify  → facilitator relays register(...)         [pays owner, joins the group]
       ├─ POST /settle  → facilitator relays settle(...)           [membership proof, scope = resourceId]
       └─ POST /access  → worker checks isSettled → returns DEK    [signed with the stealth key]

AGAIN  a second fetchResource must NOT pay again — it recomputes the nullifier
       from the identity and goes straight to the worker.
```

The facilitator is a gas-paying relayer: the buyer's stealth identity never
needs ETH and never appears on-chain, so the payment and the access are
unlinkable.

## Where the deployment comes from

Nothing here names a contract address. The seller half uses the SDK's
`SettlementRegistryClient`, and the registry address comes from the SDK's
`FangornConfig` — the same object the SDK, the CLI and the facilitator read, so
a redeploy updates one place instead of four `.env` files. The USDC address is
read off the registry itself (`getUsdc()`), because a registry that settles in a
different token than the one you signed against produces a valid signature and
no transfer.

`SETTLEMENT_REGISTRY_ADDR` still works as an override, for pointing at a
deployment the installed SDK predates.

## Prerequisites

- A running facilitator (`pnpm facilitator` from the repo root), reachable at
  `FACILITATOR_URL`.
- A reachable access worker at `WORKER_URL`, and its `WORKER_UPLOAD_TOKEN`.
  Run one locally with `pnpm dev` in `webworker/fangorn-access-worker` — that is
  `wrangler dev --local`, so R2 is **simulated on disk** under `.wrangler/state`
  and no real bucket is touched. Its `.dev.vars` must name the same
  `SETTLEMENT_REGISTRY_ADDRESS` the SDK config does, or `/access` authorizes
  against a registry that has never heard of your resource and releases nothing.
  The bucket claims its upload token on first use, so whatever
  `WORKER_UPLOAD_TOKEN` you publish with first is the one it keeps.
- **Seller** account (`EVM_PRIVATE_KEY`) with a little Arbitrum Sepolia ETH for
  the `createResource` gas.
- **Buyer** account (`BUYER_PRIVATE_KEY`) holding Arbitrum Sepolia **USDC** — it
  signs the payment but pays no gas (the facilitator relays).

## Run

```sh
cp examples/node/.env.local examples/node/.env   # then fill in the two keys
# terminal 1:  cd ../../../webworker/fangorn-access-worker && pnpm dev
# terminal 2:  pnpm facilitator
pnpm --filter node start
```

The chain is real (Arbitrum Sepolia) even when the worker is local: settlement
is what the worker gates on, so there is nothing to fake there. Only the
storage is local.

Set `RESOURCE_PRICE` (USDC base units, 6 decimals) to change the price; the
buyer's signed authorization must cover exactly that amount.

## Files

- `index.ts` — the flow above.
- `publish.ts` — the seller's half: envelope crypto (AES-256-GCM under a DEK
  sealed to the worker) and the upload.

The buyer's half is not here — it is the `@fangorn-network/fetch` middleware,
which this example consumes exactly as an external caller would.

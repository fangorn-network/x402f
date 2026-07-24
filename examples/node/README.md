# Node Example — paid content sale, end-to-end

A single self-contained script (`index.ts`) that sells one piece of encrypted
content and buys it back through the **x402f facilitator**, proving the whole
private-payment loop works:

```
SELL   encrypt → upload {ciphertext, sealed DEK} to the access worker
       createResource(resourceId, price, uri)                     [owner, on-chain]

BUY    derive Semaphore identity + stealth address                [buyer]
       sign EIP-3009 authorization paying the owner the price      [buyer]
       POST /verify  → facilitator relays register(...)            [pays owner, joins group]
       build Semaphore membership proof (scope = resourceId)       [buyer]
       POST /settle  → facilitator relays settle(...)              [records settlement]

ACCESS sign /access with the stealth key → worker checks isSettled → returns DEK
       decrypt, verify plaintext hash matches the on-chain commitment
```

The facilitator is a gas-paying relayer: the buyer's stealth identity never
needs ETH and never appears on-chain, so the payment and the access are
unlinkable.

## Prerequisites

- A running facilitator (`pnpm facilitator` from the repo root), reachable at
  `FACILITATOR_URL`.
- **Seller** account (`EVM_PRIVATE_KEY`) with a little Arbitrum Sepolia ETH for
  the `createResource` gas.
- **Buyer** account (`BUYER_PRIVATE_KEY`) holding Arbitrum Sepolia **USDC** — it
  signs the payment but pays no gas (the facilitator relays).

## Run

```sh
cp examples/node/.env.local examples/node/.env   # then fill in the two keys
pnpm --filter node start
```

Set `RESOURCE_PRICE` (USDC base units, 6 decimals) to change the price; the
buyer's signed authorization must cover exactly that amount.

## Files

- `index.ts` — the flow above.
- `settle.ts` — envelope crypto (AES-256-GCM under a DEK sealed to the worker).
- `paid.ts` — client payloads for the facilitator: identity/stealth derivation,
  EIP-3009 signing, and the Semaphore membership proof.

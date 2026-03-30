# x402f Facilitator

The `x402f facilitator` is a semi-trusted x402 facilitator that settles payments against the Fangorn [settlement registry](https://github.com/fangorn-network/contracts/tree/main/stylus/SettlementRegistry). An [x402 facilitator](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator) is a service that:
- Verifies payment payloads submitted by clients.
- Settles payments on the blockchain on behalf of servers.

The **x402f facilitator** replaces the standard verify/settle mechanism with a register/claim approach.

###### Verify -> Register

The `/verify` endpoint retains a similar same shape as standard x402, requiring a signed `transferWithAuthorization` call, except in this case the payment must be made from the caller to the facilitator itself. An additional header is sent to inform the facilitator of the buyer's identity commitment. The facilitator:
- executes the payment to itself form the caller
- generates burner keys and funds it based on the amount granted by the caller
- prepares a new transferWithAuthorization call to the settlement registry contract
- registers and claims resources on behalf of the caller, using the ephemeral burner key
- notifies the client on success/failure

###### Settle -> Claim

As oppossed to a standard x402 facilitator, settlement has technically already happened on-chain. When a client called `/settle` in this case, they must pass along a zkp that they are registered within a specific semaphore group for a specific resource id. The facilitator then:
- generates a nullifier
- submit the proof onchain
- returns the nullifier to the caller (caller needs the nullifier to decrypt)

## Run

0. From the root, run `pnpm i`
1. Setup env vars by copying the templated  `cp ~/packages/facilitator/.env.local ~/packages/facilitator.env` and fill in the details
2. Run the facilitator locally with `pnpm facilitator`

### Docker

To run as a docker image, configure env vars and then, from the root, run `docker compose up --build`.

## License 

MIT
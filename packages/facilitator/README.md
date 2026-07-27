# x402f Facilitator

The `x402f facilitator` is a semi-trusted x402 facilitator that settles payments against the Fangorn [settlement registry](https://github.com/fangorn-network/contracts/tree/main/stylus/SettlementRegistry). An [x402 facilitator](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator) is a service that:
- Verifies payment payloads submitted by clients.
- Settles payments on the blockchain on behalf of servers.

The **x402f facilitator** replaces the standard verify/settle mechanism with a register/claim approach. It is a **gas-paying relayer**: the payment and settlement logic now live entirely in the Stylus `SettlementRegistry`, so the facilitator just submits two contract calls on the buyer's behalf. This keeps the buyer's stealth identity unfunded and unlinkable — they never need gas or an on-chain footprint of their own.

The x402 wire protocol is unchanged: clients POST `paymentPayload` + `paymentRequirements` to `/verify` and `/settle` and receive standard `VerifyResponse` / `SettleResponse` bodies. The Fangorn-specific fields ride in `paymentRequirements.extra`.

###### Verify -> Register

The buyer signs an EIP-3009 `transferWithAuthorization` paying the resource owner the exact price, and includes their Semaphore identity commitment. `/verify` relays a single `register(resourceId, identityCommitment, from, to, amount, …, v, r, s)` call to the registry, which:
- runs the buyer's `transferWithAuthorization` (owner is paid directly), and
- adds the identity commitment to the global Semaphore group.

A repeat buy that is `AlreadyRegistered` is treated as success (idempotent).

`extra`: `{ resourceId, identityCommitment, payment: { from, to, amount, validAfter, validBefore, nonce, v, r, s } }`.

###### Settle -> Claim

The buyer builds a Semaphore membership proof off-chain (scope = `resourceId`). `/settle` relays a single `settle(resourceId, stealthAddress, merkleTreeDepth, merkleTreeRoot, nullifier, message, points[8], hookData)` call, which validates the proof on-chain and records the settlement keyed by the buyer's stealth address. The facilitator echoes the proof's `nullifier` back in `extensions.nullifier` — the caller uses it (and its stealth key) to unlock the DEK from the access worker.

`extra`: `{ resourceId, stealthAddress, merkleTreeDepth, merkleTreeRoot, nullifier, message, points, hookData? }`.

## Run

0. From the root, run `pnpm i`
1. Set up env vars: `cp packages/facilitator/.env.local packages/facilitator/.env` and fill in `FACILITATOR_EVM_PRIVATE_KEY` (a relayer key with testnet ETH for gas)
2. Run the facilitator locally with `pnpm facilitator`

### Docker

To run as a docker image, configure env vars and then, from the root, run `docker compose up --build`.
  

## Deploy 

``` sh
# install gcloud cli
# Update system packages and install prerequisites
sudo apt-get update

curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
tar -xf google-cloud-cli-linux-x86_64.tar.gz
./google-cloud-sdk/install.sh

# Update the gcloud CLI
gcloud components update
# Authenticate with your Google account
gcloud auth login

# view project ids with
gcloud projects list

# Set your active Google Cloud project
gcloud config set project PROJECT_ID

# enable required apis
gcloud services enable artifactregistry.googleapis.com cloudbuild.googleapis.com run.googleapis.com logging.googleapis.com
# grant the builder role on your service acct
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectViewer"

# deploy the facilitator
gcloud run compose up docker-compose.yml \
  --region us-central1

gcloud run deploy sepolia-x402f-facilitator \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```


## License 

MIT
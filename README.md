# x402f 

Pay-per-use data APIs without trusting the server.

x402f is an extension of the x402 protocol that inverts the trust model: the server never holds a plaintext, never handles payments, and cannot withhold data (even if offline). 

-> See the [node client example](./examples/node/index.ts)

## How it Works

![alt text](image.png)

## Setup

First setup environment variables by running `cp .env.local .env` and filling in the details.

## Start the Facilitator

Start the facilitator first. This will run on localhost:30333

`npm run facilitator`

## Start the server

Start the resource server once the faciltiator is running. This will run on localhost:4021

`npm run server`

## Run the node client example

First install tsx with `npm install -D tsx`. Then run the example with `npm run client:node`.

For data **consumers**: 
- You *start* with a ciphertext before making a payment, which is decrypted locally. This also ensures data cannot be withheld post-purchase.
- Pricing and ownership is verifiable against the finalized chain state.

For data **sellers**:
- You do not need to support any infrastructure at all to use the solution, as it only needs one resource server. However, anybody can run their own dedicated resource server if they choose (there can be multiple, but don't need to be).
- You can dynamically price data without trusting the server or making code changes.

## Architecture

It uses [fangorn](https://github.com/fangorn-network/fangorn) for encryption and datasource registration/management. See the fangorn readme to learn how to register datasources and upload data that can be sold via x402f.

## License 

MIT 
# Node Example

This node script demonstrates usage of `@x402f/fetch` to purchase and consumer data anonymously.

## The Demo

1. define a schema
2. register the schema
3. upload some data that conforms to the schema
4. purchase access, download the ciphertext bundle, decrypt

---

#### Schema registration

We will use the simple schema below, and call it `noagent-fangorn.test.music.v0`:

Save this as `schema.json` locally:

``` json
{
    "title": { "@type": "string" },
    "artist": { "@type": "string" },
    "audio": { "@type": "encrypted", "gadget": "settled" }
}
```

Then, we register this with fangorn using the CLI `fangorn schema register noagent-fangorn.test.music.v0 -e`

Verify the schema is registered with:

`fangorn schema get noagent-fangorn.test.music.v0 -c arbitrumSepolia`

schema id = 0xdd2d15d54e402ac7383280029bd15eb039fba2b3ee0025ea846c67b55155bc9c

#### Schema Conformant Data

We will use mock data for the sake of the demo. Save the following locally as `data.json`:

``` json
{
    "tag": "track-01",
    "fields": {
        "title": "Track One",
        "artist": "Alice",
        "audio": { "data": [1, 2, 3, 4, 5], "fileType": "audio/mp3" }
    }
}
```

Then we publish the data, setting an unlock price of `$0.000001 USDC` for the actual audio data.

``` sh
fangorn publish upload ~/fangorn/x402f/examples/node/data.json \
    -s noagent-fangorn.test.music.v0 \
    -c arbitrumSepolia \
    -p 1
```
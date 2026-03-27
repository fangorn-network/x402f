```
gcloud auth login
gcloud config set project lucky-lead-489114-d7
gcloud services enable run.googleapis.com artifactregistry.googleapis.com

gcloud artifacts repositories create x402f \
  --repository-format=docker \
  --location=us-central1

gcloud auth configure-docker us-central1-docker.pkg.dev

# Facilitator
docker build -f packages/facilitator/Dockerfile \
  -t us-central1-docker.pkg.dev/lucky-lead-489114-d7/x402f/facilitator:latest .
docker push us-central1-docker.pkg.dev/lucky-lead-489114-d7/x402f/facilitator:latest

gcloud run deploy facilitator \
  --image us-central1-docker.pkg.dev/lucky-lead-489114-d7/x402f/facilitator:latest \
  --platform managed \
  --region us-central1 \
  --port 30333 \
  --allow-unauthenticated \
  --set-env-vars FACILITATOR_EVM_PRIVATE_KEY=0xde0e6c1c331fcd8692463d6ffcf20f9f2e1847264f7a3f578cf54f62f05196cb,CHAIN_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc,FACILITATOR_DOMAIN=http://0.0.0.0,FACILITATOR_PORT=30333,CHAIN="arbitrumSepolia",USDC_DOMAIN_NAME="USD Coin",USDC_CONTRACT_ADDR=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d,SETTLEMENT_TRACKER_ADDR=0x5e918ba3fe33b0bdc68cd46eb6a77db754edef57,EMAIL=driewmworks@fangorn.network
    
```

```
https://facilitator-133282782456.us-central1.run.app
```


### call the facilitator

curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" https://facilitator-133282782456.us-central1.run.app/supported

## Service Acct setp

Ok so there are a couple ways to do this.
I have decided to just go with the simplest route for now:

### setup application default credentials

gcloud auth application-default login

# set oursevles as invoker
gcloud run services add-iam-policy-binding facilitator \
  --region us-central1 \
  --member="user:driemworks@fangorn.network" \
  --role="roles/run.invoker"

# create service acct
gcloud iam service-accounts create service-a-sa \
  --display-name="x402f resource Server"

# grant it permission to invoke the other service 
 gcloud run services add-iam-policy-binding service-b \
  --region=us-centr al1 \
  --member="serviceAccount:service-a-sa@lucky-lead-489114-d7.iam.gserviceaccount.com" \
  --role="roles/run.invoker" 


  # deploy service a with the service acct

  gcloud run deploy service-a \
  --service-account=service-a-sa@lucky-lead-489114-d7.iam.gserviceaccount.com \
  ...     



  I'm so confused with all of this, cloudrun is wacky

  gcloud iam service-accounts keys create key.json \
  --iam-account=driemworks@fangorn.network
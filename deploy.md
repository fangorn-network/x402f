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

# Server
docker build -f packages/server/Dockerfile \
  -t us-central1-docker.pkg.dev/lucky-lead-489114-d7/x402f/server:latest .
docker push us-central1-docker.pkg.dev/lucky-lead-489114-d7/x402f/server:latest

gcloud run deploy facilitator \
  --image us-central1-docker.pkg.dev/lucky-lead-489114-d7/x402f/facilitator:latest \
  --platform managed \
  --region us-central1 \
  --port 30333 \
  --allow-unauthenticated \
  --set-env-vars FACILITATOR_EVM_PRIVATE_KEY=0xde0e6c1c331fcd8692463d6ffcf20f9f2e1847264f7a3f578cf54f62f05196cb,CHAIN_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc,PINATA_JWT='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJhNWFiOTAzNC04NDZmLTQ0YTMtOWUxMy1iYzViMGY4NGZhNWIiLCJlbWFpbCI6ImRyaWVtd29ya3NAZmFuZ29ybi5uZXR3b3JrIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBpbl9wb2xpY3kiOnsicmVnaW9ucyI6W3siZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiRlJBMSJ9LHsiZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiTllDMSJ9XSwidmVyc2lvbiI6MX0sIm1mYV9lbmFibGVkIjpmYWxzZSwic3RhdHVzIjoiQUNUSVZFIn0sImF1dGhlbnRpY2F0aW9uVHlwZSI6InNjb3BlZEtleSIsInNjb3BlZEtleUtleSI6IjAwMzQyMDNmZTI2NDY4M2Y0OWM1Iiwic2NvcGVkS2V5U2VjcmV0IjoiMTgxMGM1YmQwNWFiNDM2ZjE3OThiYWM0NzFlN2EzMDQxM2MyODU1MTYzZmU4M2FmMmI2YjNiNWY0MGRjZTU0OCIsImV4cCI6MTgwMTY4NzUzOX0.8HBsF9e38rtP8b5MbCUMoDcTcsP9SkEmpRR0_6sip00',PINATA_GATEWAY='lavender-tricky-lungfish-862.mypinata.cloud',FACILITATOR_DOMAIN=http://0.0.0.0,FACILITATOR_PORT=30333,CHAIN="arbitrumSepolia",USDC_DOMAIN_NAME="USD Coin",USDC_CONTRACT_ADDR=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d,SETTLEMENT_TRACKER_ADDR=0x7c6ae9eb3398234eb69b2f3acfae69065505ff69
    
```

```
https://facilitator-133282782456.us-central1.run.app
```

gcloud run deploy server \
  --image us-central1-docker.pkg.dev/lucky-lead-489114-d7/x402f/server:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account=x402f-server@lucky-lead-489114-d7.iam.gserviceaccount.com \
  --port 4021 \
  --set-env-vars EVM_PRIVATE_KEY=0xde0e6c1c331fcd8692463d6ffcf20f9f2e1847264f7a3f578cf54f62f05196cb,CHAIN_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc,PINATA_JWT='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJhNWFiOTAzNC04NDZmLTQ0YTMtOWUxMy1iYzViMGY4NGZhNWIiLCJlbWFpbCI6ImRyaWVtd29ya3NAZmFuZ29ybi5uZXR3b3JrIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBpbl9wb2xpY3kiOnsicmVnaW9ucyI6W3siZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiRlJBMSJ9LHsiZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiTllDMSJ9XSwidmVyc2lvbiI6MX0sIm1mYV9lbmFibGVkIjpmYWxzZSwic3RhdHVzIjoiQUNUSVZFIn0sImF1dGhlbnRpY2F0aW9uVHlwZSI6InNjb3BlZEtleSIsInNjb3BlZEtleUtleSI6IjAwMzQyMDNmZTI2NDY4M2Y0OWM1Iiwic2NvcGVkS2V5U2VjcmV0IjoiMTgxMGM1YmQwNWFiNDM2ZjE3OThiYWM0NzFlN2EzMDQxM2MyODU1MTYzZmU4M2FmMmI2YjNiNWY0MGRjZTU0OCIsImV4cCI6MTgwMTY4NzUzOX0.8HBsF9e38rtP8b5MbCUMoDcTcsP9SkEmpRR0_6sip00',PINATA_GATEWAY='lavender-tricky-lungfish-862.mypinata.cloud',DOMAIN=localhost:3000,FACILITATOR_URL=https://facilitator-133282782456.us-central1.run.app,AUTH_TOKEN="eyJhbGciOiJSUzI1NiIsImtpZCI6IjI1MDdmNTFhZjJhMTYyNDY3MDc0ODQ2NzRhNDJhZTNjMmI2MjMxOWMiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiIzMjU1NTk0MDU1OS5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbSIsImF1ZCI6IjMyNTU1OTQwNTU5LmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29tIiwic3ViIjoiMTExNTMwMTkzNjI4MDAwMjA4OTExIiwiaGQiOiJmYW5nb3JuLm5ldHdvcmsiLCJlbWFpbCI6ImRyaWVtd29ya3NAZmFuZ29ybi5uZXR3b3JrIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImF0X2hhc2giOiJfX01mUEdKTWFidFFCX042VjJpaU9BIiwiaWF0IjoxNzcyNTkxMzAyLCJleHAiOjE3NzI1OTQ5MDJ9.UueasA8LfpDSl2Itn5irTOOi_IL7nlj3txSt_bVaimZp-WJPf-3qkNy-OJP4zO2cxF7FDnf2tRTZh-TfZc-C7OLwSerHd79-FAM_SwDsWh5n-T3F95R9lOID8I1gxXojmzLTS5eTJmcsr47lCRs4Cwmnl9vmoVAGxN-0JGtGmB2kyr1EmNOe4ovacIj7Wfma9DgFlpwP3Hkkchw7Y6uZFn1y85NUmD22hUdduC_AK4rxBS0rpMPwOHVjruQeeTLxgsDOwtfqBhCvPwqVZRllhTHL77dnEjq3FYPY3S1dtPJhvytTW6484BJXBkZX8j2K_GvMvRJJ3eQg65oJBeZcuA",RESOURCE_SERVER_DOMAIN=host.docker.internal,SERVER_PORT=4021,CHAIN="arbitrumSepolia",USDC_DOMAIN_NAME="USD Coin",USDC_CONTRACT_ADDR=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d


https://server-133282782456.us-central1.run.app


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
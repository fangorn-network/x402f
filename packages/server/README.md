# x402f Access Control Server

# create service acct

gcloud iam service-accounts create server-caller \
  --project=lucky-lead-489114-d7 \
  --display-name="Server Caller"

# grant permission to call the facilitator

gcloud run services add-iam-policy-binding facilitator \
  --region=us-central1 \
  --project=lucky-lead-489114-d7 \
  --member="serviceAccount:server-caller@lucky-lead-489114-d7.iam.gserviceaccount.com" \
  --role="roles/run.invoker"  


# download the key file

gcloud iam service-accounts keys create ./service-account.json \
  --iam-account=server-caller@lucky-lead-489114-d7.iam.gserviceaccount.com

### Step 4 — Add to `.gitignore`
```
service-account.json

# set env  vars

GOOGLE_APPLICATION_CREDENTIALS=./service-account.json   

# deploy server w/ service acct

gcloud run deploy server \
  --service-account=server-caller@lucky-lead-489114-d7.iam.gserviceaccount.com \
  --region=us-central1 \
  --project=lucky-lead-489114-d7

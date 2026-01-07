# HK API - Housekeeping Backend for Miami Beach Resort

Cloud-based backend API for the housekeeping management system.

## Endpoints

- `GET /` - Health check
- `POST /save` - Save data `{type, data, timestamp}`
- `GET /load?type=xxx` - Load data by type
- `GET /list` - List all stored data types
- `DELETE /delete?type=xxx` - Delete data by type

## Data Types

- `staffList` - Staff members
- `dailyAssignments` - Daily floor assignments
- `customRequestTypes` - Custom request types
- `roomStatuses` - Room status data
- `requests` - Guest requests

## Deploy to Cloud Run

```bash
# Build and deploy
gcloud builds submit --config cloudbuild.yaml --project beds24-483408

# Or manual deploy
gcloud run deploy hk-api \
  --source . \
  --project beds24-483408 \
  --region us-central1 \
  --allow-unauthenticated
```

## Local Development

```bash
npm install
npm start
```

Service runs on port 8080.

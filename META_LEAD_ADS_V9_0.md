# PROPERTY SCE MASTER V9.0 — META LEAD ADS CONNECTION

## Added
- Meta webhook verification endpoint: `GET /webhooks/meta`
- Meta lead webhook receiver: `POST /webhooks/meta`
- HMAC SHA-256 signature validation using `META_APP_SECRET`
- Meta Graph API lead retrieval using `META_PAGE_ACCESS_TOKEN`
- Lead field normalization into PROPERTY SCE MASTER CRM
- Deduplication using Meta `leadgen_id`
- Raw Meta payload retained in the lead ingestion event record
- Existing V8.9 normalized integration remains available for controlled bridge/automation testing.

## Render API environment variables
Required for the Meta connection:
- `META_VERIFY_TOKEN`
- `META_APP_SECRET`
- `META_PAGE_ACCESS_TOKEN`
- `META_GRAPH_VERSION` (default: `v24.0`)
- Existing: `LEAD_WEBHOOK_SECRET`, `LEAD_WEBHOOK_WORKSPACE_ID`, `DATABASE_URL`

## Meta webhook URL
Production endpoint:
`https://property-sce-master-api.onrender.com/webhooks/meta`

The Meta dashboard/app configuration must use the same Verify Token stored in Render.

## Important
The code is Meta-integration ready, but actual Meta Page/App authorization, webhook subscription, permissions and production credentials still have to be configured in Meta. No claim is made that the user's Meta account is connected until a real test lead is received successfully.

## Data safety
- Meta access token remains backend-only.
- Webhook signature is validated before processing.
- Meta numeric campaign/ad IDs are stored in ingestion notes; they are not guessed as internal UUID campaign IDs.
- No CRM stage is auto-advanced beyond initial `new`.

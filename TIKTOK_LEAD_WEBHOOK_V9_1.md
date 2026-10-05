# PROPERTY SCE MASTER V9.1 — TikTok Lead Webhook Foundation

## Scope
V9.1 adds a direct TikTok webhook receiver while keeping the existing normalized lead bridge.

### Production endpoint
- TikTok webhook: `POST /webhooks/tiktok`
- Meta webhook: `POST /webhooks/meta`
- Normalized bridge: `POST /api/integrations/leads/{meta|tiktok}`

## TikTok verification
The backend validates the `TikTok-Signature` header using HMAC-SHA256 over:
`timestamp + "." + raw_request_body`
with `TIKTOK_CLIENT_SECRET` as the key.

The timestamp is rejected when it is older/newer than the configured tolerance. Default: 300 seconds.

## Environment
- TIKTOK_CLIENT_KEY
- TIKTOK_CLIENT_SECRET
- TIKTOK_SIGNATURE_MAX_AGE_SECONDS
- LEAD_WEBHOOK_SECRET
- LEAD_WEBHOOK_WORKSPACE_ID

Secrets must remain in Render environment variables and are never exposed in the frontend.

## Lead mapping
The webhook accepts TikTok event content as JSON and looks for:
- lead_id / leadId / external_id / externalId / id
- full_name / name / fullName
- phone_number / phone / whatsapp
- email

Nested `content.data`, `content.lead`, and `content.fields` are supported.

Only events carrying an external lead identifier and at least one contact field are ingested. Other verified webhook events are acknowledged with HTTP 200 and ignored.

## Safety
- Raw-body signature verification
- Constant-time signature comparison
- Timestamp replay window
- PostgreSQL idempotency on provider + external_id
- No automatic pipeline stage advancement
- No guessed internal campaign/creative UUIDs from TikTok numeric identifiers
- Raw provider payload retained in `lead_ingestion_events`

## Important platform note
TikTok's official documentation provides webhook subscriptions and a Leads API. V9.1 implements the webhook security and normalized ingestion layer, but a live TikTok account/app authorization and a real lead-event payload still need to be configured/tested before claiming live lead delivery.

## Verification checklist
1. Add TikTok client key/secret in Render.
2. Configure the TikTok developer app webhook URL to the production endpoint.
3. Subscribe the required lead-related event supported by the TikTok account/app.
4. Submit a real/test lead.
5. Confirm HTTP 200 from the webhook.
6. Confirm a new TikTok lead in PROPERTY SCE MASTER CRM.
7. Confirm duplicate delivery does not create a second lead.

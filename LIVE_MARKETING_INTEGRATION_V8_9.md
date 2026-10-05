# PROPERTY SCE MASTER V8.9 — LIVE MARKETING INTEGRATION

## Status
V8.9 adds the production integration foundation for inbound leads from Meta/Facebook/Instagram and TikTok.

## What is live in code
- `GET /api/integrations/status` — authenticated integration status.
- `POST /api/integrations/leads/meta` — normalized Meta lead intake endpoint.
- `POST /api/integrations/leads/tiktok` — normalized TikTok lead intake endpoint.
- `lead_ingestion_events` table for provider + external_id deduplication.
- Lead intake validates workspace, stores normalized lead data in PostgreSQL and preserves source/provider.
- Frontend V8.9 Integration Center shows setup state without exposing secrets.

## Required Render API environment variables
- `LEAD_WEBHOOK_SECRET`
- `LEAD_WEBHOOK_WORKSPACE_ID`
- Existing production variables remain unchanged, including `DATABASE_URL`, R2 variables and JWT settings.

## Normalized webhook contract
Header:
- `x-sce-webhook-secret: <backend secret>`

JSON:
- `external_id` (required)
- `name`
- `phone`
- `email`
- `property_id` (optional; must belong to workspace)
- `campaign_id` (optional; must belong to workspace)
- `creative_id` (optional; must belong to workspace)
- `funnel_stage`
- `source`
- `notes`

## Important scope
V8.9 is integration-ready, not proof that Meta/TikTok accounts are already authorized. Platform OAuth/API authorization and the final platform-specific field/signature mapping must still be configured before production lead traffic is sent.

## Safety
- Secrets stay in backend environment variables.
- Frontend never receives platform access tokens.
- Duplicate external lead IDs are deduplicated.
- Invalid property/campaign/creative references are not guessed.
- No automatic CRM stage change is performed by the webhook.

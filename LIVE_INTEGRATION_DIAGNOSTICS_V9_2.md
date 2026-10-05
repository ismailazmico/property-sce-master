# PROPERTY SCE MASTER V9.2 — Live Integration Diagnostics

V9.2 adds a read-only diagnostics layer for the Meta/TikTok lead integrations.

## API
Authenticated endpoint:
`GET /api/integrations/diagnostics`

Checks:
- PostgreSQL connectivity
- LEAD_WEBHOOK_WORKSPACE_ID matches the authenticated workspace
- normalized webhook secret exists
- Meta webhook credentials are present
- TikTok client key and client secret are present

The endpoint never returns secrets.

## Dashboard
Integration Center now shows:
- PASS / ACTION REQUIRED for each integration prerequisite
- next steps
- Meta/TikTok webhook endpoints
- explicit read-only safety notice

## Live testing rule
Diagnostics do not create leads and do not mutate CRM data.

A live integration is only considered verified after a real/test provider event reaches the production webhook and creates exactly one normalized CRM lead. A repeated delivery must remain a duplicate.

## TikTok official setup
TikTok's Developer Portal provides a Webhooks configuration where a callback URL can be entered and a Test URL action can send a test event. TikTok's webhook verification requires validating the `TikTok-Signature` header using the timestamp, raw JSON payload and client secret.

Production callback:
`https://property-sce-master-api.onrender.com/webhooks/tiktok`

## Meta
Meta callback remains:
`https://property-sce-master-api.onrender.com/webhooks/meta`

Meta credentials and Page authorization must be configured separately. Do not place secrets in the frontend or chat.

## Current safety posture
- Read-only diagnostics
- Raw-body signature verification
- Replay-window protection for TikTok
- Duplicate protection by provider + external ID
- No automatic stage advancement
- No guessed internal campaign/creative UUIDs

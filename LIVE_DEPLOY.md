# PROPERTY SCE MASTER — LIVE DEPLOY

## Status
This package is deployment-ready. It is NOT yet publicly deployed because a hosting account must authorize the deployment.

## Recommended path: Render
1. Create/sign in to a Render account.
2. Create a Git repository and upload this entire package.
3. In Render choose **New → Blueprint** and select the repository.
4. Render reads `render.yaml` and creates:
   - `property-sce-master-web` — public web app
   - `property-sce-master-api` — API
   - `property-sce-master-db` — PostgreSQL
5. Wait for all services to become Live.
6. Open the web service URL.

## Important production note
The current web interface is a V4 prototype frontend using browser localStorage for its interactive demo data. The API/database layer is production-structured, but the frontend-to-API integration, real AI provider, object storage, WhatsApp Business API, and Meta/TikTok publishing adapters still require configuration/implementation before treating this as a full production SaaS.

## Demo API login
- Email: admin@sce.local
- Password: demo123

Replace demo authentication and secrets before real customer use.

## Database migration
After PostgreSQL is created, apply:
`database/migrations/001_init.sql`

## Custom domain
After deployment, attach your domain in the hosting provider's custom-domain settings and point DNS as instructed by the provider.

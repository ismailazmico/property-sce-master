# PROPERTY SCE MASTER V4.4.0 — Campaign Builder

## Frontend
- Campaign Builder: Property → Platform → Objective → Funnel → Budget → Dates → Notes
- Auto preview of creative counts and property leads
- Save campaign to API database
- Campaign Library with status: Draft / Ready / Running / Paused / Completed
- Keeps V4.3 bulk creative workflow intact

## API
- Adds `campaigns` table automatically on startup when PostgreSQL is available
- Adds GET/POST/PATCH `/api/campaigns`
- Health version: 4.4.0

## Deploy
1. Deploy frontend static root (`index.html`) to Render.
2. Deploy API from `apps/api` to Render with the existing production environment variables.
3. Keep the existing DATABASE_URL, JWT_SECRET, WEB_ORIGIN and R2 variables.
4. After deploy, open Campaigns and create a test campaign.

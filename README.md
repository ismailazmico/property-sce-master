# PROPERTY SCE MASTER V4.0 — Production Blueprint

This is the consolidated production architecture package.

## Included
- Responsive web application
- REST API with JWT boundary
- RBAC model
- Multi-tenant workspace model
- PostgreSQL schema
- Property management
- Media signed-upload boundary
- Lead CRM
- AI job endpoint
- Creative render endpoint
- Campaign data model
- Audit log model
- Docker deployment foundation
- Environment template
- Production security checklist

## Demo frontend
Open `apps/web/index.html`.

## API
`cd apps/api && npm install && npm run dev`

## Database
Run PostgreSQL and apply:
`database/migrations/001_init.sql`

## Important
The included API has a safe architectural boundary but uses demo/in-memory fallbacks when DATABASE_URL is absent. Replace demo authentication and secrets before production deployment.

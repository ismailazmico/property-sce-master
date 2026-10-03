# PROPERTY SCE MASTER — FINAL RELEASE CANDIDATE

Version: 4.0 RC1

This package consolidates the PROPERTY SCE MASTER architecture into one release candidate.

## Included
- Web dashboard
- Property database
- Media library boundary
- AI Ads Engine
- Creative Renderer specification
- Lead CRM
- Campaign model
- Workspace / RBAC model
- PostgreSQL schema
- REST API
- Docker foundation
- Environment template
- Production checklist

## Local demo
Open:
`apps/web/index.html`

The browser demo uses local storage and does not require a server.

## API local setup
1. Install Node.js 22+.
2. `cd apps/api`
3. `npm install`
4. Set `DATABASE_URL` and `JWT_SECRET`.
5. `npm run dev`

## Database
Use PostgreSQL 16+ and run:
`database/migrations/001_init.sql`

## Production gate
Do not use demo credentials, fallback in-memory mode, default database password, or the example JWT secret in production.

Replace:
- demo login
- JWT secret
- database credentials
- object-storage credentials
- AI credentials
- WhatsApp credentials
- advertising platform credentials

Then add HTTPS, managed database, object storage/CDN, worker queue, monitoring, backups, rate limiting and audit review.

## Final business flow
Property → AI Ads → Creative → Campaign → Lead → Viewing → Closed.

PROPERTY SCE MASTER V4.2.0 - Creative Poster patch

Replace only these files in the existing repository:
- index.html (repository root)
- apps/api/package.json
- apps/api/src/server.mjs

Do NOT delete or replace apps/api/migration.sql.

After GitHub commit, redeploy both Render services if auto-deploy is disabled.
Required API environment variables:
DATABASE_URL, JWT_SECRET, WEB_ORIGIN, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.

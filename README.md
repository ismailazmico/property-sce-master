# PROPERTY SCE MASTER V4.2.0 — Creative Poster Preview

Next production module after V4.1.7:
- Creative Renderer connects Property + Media Library + Funnel.
- Media uses a 15-minute Cloudflare R2 signed URL.
- Poster preview supports 4:5, 1:1 and 9:16.
- Creative spec is saved to `creative_renders`.
- WhatsApp CTA defaults to 019-7498699.

## Deploy
API: replace `apps/api/src/server.mjs` and `apps/api/package.json` in the existing API service, then redeploy.
Web: deploy `apps/web/index.html` to the existing static frontend, then redeploy.
Do not paste R2 secret keys into chat or source code.

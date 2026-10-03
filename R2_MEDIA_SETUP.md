# PROPERTY SCE MASTER — R2 Media Upload

This patch connects Media Library to Cloudflare R2 using server-side uploads.

Required API environment variables:
- R2_ACCOUNT_ID
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- R2_BUCKET_NAME

The API uploads image files to R2 and then records the media metadata in PostgreSQL.
No R2 public bucket is required for upload.

Deploy notes:
- API dependencies include @aws-sdk/client-s3 and multer.
- Media endpoint: POST /api/media/upload (authenticated multipart/form-data).
- Health endpoint reports `r2: true` when all four R2 variables are present.

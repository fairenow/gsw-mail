# GSW Mail R2 storage setup

Phase 1 uses a private Cloudflare R2 bucket as the binary storage layer for GSW Files. PostgreSQL/Neon stores ownership, quota, folder, and asset metadata; R2 stores the bytes.

## 1. Create the bucket

Create a private R2 bucket named:

```
gsw-mail-assets
```

Do not enable public bucket listing.

## 2. Create an R2 API token

Create a token scoped only to `gsw-mail-assets` with Object Read & Write access.

Add these environment variables to the API/Railway service:

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=gsw-mail-assets
R2_PRESIGN_TTL_SECONDS=900

# Product defaults
FILES_FREE_QUOTA_BYTES=524288000
FILES_MAX_UPLOAD_BYTES=524288000
```

The default free-user quota is 500 MiB. Quotas are stored per user in `user_storage_quotas`, so paid plans can override the default later without changing bucket configuration.

## 3. Configure bucket CORS

Direct browser uploads use short-lived presigned PUT URLs, so the R2 bucket must allow the GSW Mail web origin.

Example CORS policy:

```json
[
  {
    "AllowedOrigins": [
      "https://mail.guidedstepswellness.com",
      "http://localhost:3000",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD", "DELETE"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

If production uses another web hostname, add that exact origin.

## 4. Upload flow

1. Client calls `POST /product/files/uploads` with filename, MIME type, and byte size.
2. API checks the user's storage quota and creates an `upload_pending` asset.
3. API returns a short-lived presigned R2 PUT URL.
4. Browser uploads directly to R2.
5. Client calls `POST /product/files/:id/complete`.
6. API verifies the object with R2 HEAD and marks the asset `ready`.

The R2 secret never reaches the browser.

## 5. Current file endpoints

- `GET /product/files/usage`
- `GET /product/files`
- `POST /product/files/folders`
- `POST /product/files/uploads`
- `POST /product/files/:id/complete`
- `GET /product/files/:id/download`
- `DELETE /product/files/:id`

Downloads are also private and use short-lived presigned URLs.

## 6. Database rollout

The API calls `ensureFilesSchema()` at startup, so the new tables are created idempotently during deployment. An explicit migration is also checked in at:

```
apps/api/drizzle/0023_r2_file_assets.sql
```

New tables:

- `user_storage_quotas`
- `assets`
- `file_nodes`
- `asset_links`

## 7. Next migrations onto the asset layer

Once R2 credentials are live and upload/download is verified, move these existing payloads to asset IDs:

1. custom template `logo_base64`
2. profile image uploads / `profileImageUrl`
3. `draft_attachment_payloads.content_base64`
4. chat uploads and generated artifacts

Keep the legacy fields readable during the transition so existing templates and drafts continue to work while backfill runs.

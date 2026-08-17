# Backend README updates

This project now stores reply S3 object keys in the database rather than storing
presigned URLs. To obtain a fresh presigned URL for a reply, use the endpoint:

GET /voicemails/:id/reply

Authentication
- This endpoint is protected by a simple API key. Set the environment variable
  REPLY_ENDPOINT_API_KEY to a secret value and provide it in requests via either:
    - Authorization: Bearer <REPLY_ENDPOINT_API_KEY>
    - X-API-KEY: <REPLY_ENDPOINT_API_KEY>

Rate limiting
- The reply endpoint has a simple per-IP rate limiter. Configure via env vars:
  - REPLY_RATE_WINDOW_MS (default 60000 = 60s)
  - REPLY_RATE_MAX (default 30 requests per window)

Response:
{
  "url": "https://...s3.amazonaws.com/replies/...",
  "expires_in": 3600
}

This ensures presigned links are generated on demand and do not expire in the DB.

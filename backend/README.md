# Backend README updates

This project now stores reply S3 object keys in the database rather than storing
presigned URLs. To obtain a fresh presigned URL for a reply, use the endpoint:

GET /voicemails/:id/reply

Response:
{
  "url": "https://...s3.amazonaws.com/replies/...",
  "expires_in": 3600
}

This ensures presigned links are generated on demand and do not expire in the DB.

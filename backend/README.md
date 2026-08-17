# Worker & DB queue added

I added a background worker implementation and DB schema. To run:

1) Ensure Redis and Postgres are running and environment variables are set in .env:
   - REDIS_URL
   - DATABASE_URL
2) Apply DB schema:
   psql $DATABASE_URL -f db/schema.sql
3) Install dependencies:
   npm install
4) Start worker in a separate terminal:
   npm run worker

The worker listens for jobs added by the webhook and processes them (transcription, LLM, TTS, SMS).

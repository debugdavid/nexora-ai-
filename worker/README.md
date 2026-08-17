# Nexis AI - background worker and DB queue

This update adds a background worker using Bull (Redis) and Postgres for persistence.

What changed:
- backend/server.js now enqueues processing jobs and returns immediately (fast response to Twilio).
- worker/processor.js processes jobs: downloads audio from S3, transcribes with OpenAI Whisper, calls the OpenAI Responses API, generates TTS (ElevenLabs), uploads reply audio to S3, sends SMS via Twilio, and updates DB state.
- db/schema.sql: simple voicemails table.
- package.json: added dependencies for Bull, ioredis, and pg.
- .env.example: added DATABASE_URL and REDIS_URL entries.

Run instructions (local):
1) Create Postgres DB and Redis, set DATABASE_URL and REDIS_URL in .env
2) Apply schema: psql $DATABASE_URL -f db/schema.sql
3) Start backend: npm run dev
4) Start worker: npm run worker


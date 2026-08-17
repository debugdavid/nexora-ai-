# Nexis AI - Quick Async Reply Implementation

This branch adds a working async-reply implementation that:
- Receives Twilio voicemail webhooks
- Downloads the recording, uploads original to S3
- Transcribes audio using OpenAI Whisper API
- Sends the transcript to OpenAI Responses API to generate a reply
- Synthesizes reply audio using ElevenLabs (if configured)
- Uploads reply audio to S3 and sends the caller an SMS with the reply link

How to run (quick):
1) Copy .env.example -> .env and fill in values:
   - AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
   - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
   - OPENAI_API_KEY
   - ELEVENLABS_API_KEY (optional — if omitted, SMS will contain text reply)
2) npm install
3) npm run dev
4) Expose your local port to the internet (ngrok http 3000) and set Twilio voice webhook
   to: https://<your-ngrok>/webhooks/voicemail (HTTP POST)
5) Call your Twilio number and leave a voicemail. The webhook will process and text a reply link.

Notes:
- This implementation uses direct OpenAI REST endpoints via axios for transcription and responses.
- Adjust model names via OPENAI_LLM_MODEL env var if desired.
- In production, validate Twilio requests, add retries, background job queues, and persist metadata in a DB.

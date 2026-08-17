require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const Twilio = require('twilio');
const { Pool } = require('pg');
const Queue = require('bull');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

AWS.config.update({ region: process.env.AWS_REGION });
const s3 = new AWS.S3();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const processingQueue = new Queue('nexis-processing', redisUrl);

async function downloadFile(url) {
  const r = await axios.get(url, { responseType: 'arraybuffer' });
  return r.data;
}

async function uploadToS3(buffer, key, contentType='application/octet-stream') {
  await s3.putObject({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }).promise();
  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

app.post('/webhooks/voicemail', async (req, res) => {
  try {
    const { RecordingUrl, RecordingSid, CallSid, From } = req.body;
    if (!RecordingUrl) return res.status(400).send('no recording');

    const mediaUrl = RecordingUrl.endsWith('.wav') || RecordingUrl.endsWith('.mp3')
      ? RecordingUrl
      : `${RecordingUrl}.wav`;

    // Download audio
    const audioBuffer = await downloadFile(mediaUrl);

    // Upload original to S3
    const key = `voicemails/${RecordingSid || uuidv4()}.wav`;
    const s3Url = await uploadToS3(audioBuffer, key, 'audio/wav');

    // Persist a row in DB for tracking
    const client = await pool.connect();
    const insertRes = await client.query(
      `INSERT INTO voicemails (recording_sid, s3_key, s3_url, from_number, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [RecordingSid || null, key, s3Url, From || null, 'uploaded']
    );
    const voicemailId = insertRes.rows[0].id;
    client.release();

    // Enqueue job to process transcription/LLM/TTS
    await processingQueue.add({ voicemailId }, { attempts: 3, backoff: 5000 });

    // Immediate TwiML response so Twilio won't retry
    res.type('text/xml').send('<Response><Say>Thanks — your message was received. We will text you a reply shortly.</Say></Response>');
  } catch (err) {
    console.error('webhook error', err?.response?.data || err.message);
    res.status(500).send('error');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log(`Nexis AI webhook listening on ${port}`));

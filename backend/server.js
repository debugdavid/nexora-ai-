require('dotenv').config();
const express = require('express');
const axios = require('../lib/retryable-axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const Twilio = require('twilio');
const twilioLib = require('twilio');
const { Pool } = require('pg');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

AWS.config.update({ region: process.env.AWS_REGION });
const s3 = new AWS.S3();

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

function getFullRequestUrl(req) {
  if (process.env.HOST && process.env.HOST.startsWith('http')) {
    return `${process.env.HOST}${req.originalUrl}`;
  }
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

function validateTwilioRequest(req) {
  const signature = req.headers['x-twilio-signature'];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  const url = getFullRequestUrl(req);
  try {
    return twilioLib.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body || {});
  } catch (e) {
    console.warn('Twilio validateRequest error', e?.message || e);
    return false;
  }
}

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
  return key;
}

function getPresignedUrl(key, expiresSeconds = parseInt(process.env.PRESIGNED_URL_EXPIRY_SECONDS || '3600', 10)) {
  if (!key) return null;
  const params = { Bucket: process.env.S3_BUCKET, Key: key, Expires: expiresSeconds };
  return s3.getSignedUrl('getObject', params);
}

async function transcribeAudio(buffer, filename='voicemail.wav') {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const form = new FormData();
  form.append('file', buffer, { filename });
  form.append('model', 'whisper-1');

  const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...form.getHeaders()
    },
    responseType: 'json'
  });
  return res.data.text;
}

async function callLLM(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  try {
    const body = {
      model: process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',
      input: `You are Nexis AI, an assistant for voicemail messages. Reply succinctly and helpfully to this voicemail transcript:\n\n${prompt}`
    };
    const r = await axios.post('https://api.openai.com/v1/responses', body, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    if (r.data.output && Array.isArray(r.data.output) && r.data.output.length) {
      return r.data.output.map(o => (typeof o === 'string' ? o : (o.content && o.content[0] && o.content[0].text) || '')).join('\n');
    }
    if (r.data.choices && r.data.choices.length) {
      return r.data.choices.map(c => c.text || c.message?.content || '').join('\n');
    }
    return JSON.stringify(r.data);
  } catch (err) {
    console.error('LLM error', err?.response?.data || err.message);
    throw err;
  }
}

async function synthesizeSpeechElevenLabs(text) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  const voice = process.env.ELEVENLABS_VOICE || 'alloy';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;
  const body = { text };
  const r = await axios.post(url, body, {
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    },
    responseType: 'arraybuffer'
  });
  return Buffer.from(r.data);
}

app.post('/webhooks/voicemail', async (req, res) => {
  try {
    if (!validateTwilioRequest(req)) {
      console.warn('Invalid Twilio signature for request from', req.ip);
      return res.status(403).send('invalid signature');
    }

    const { RecordingUrl, RecordingSid, CallSid, From } = req.body;
    if (!RecordingUrl) return res.status(400).send('no recording');

    const mediaUrl = RecordingUrl.endsWith('.wav') || RecordingUrl.endsWith('.mp3')
      ? RecordingUrl
      : `${RecordingUrl}.wav`;

    const audioBuffer = await downloadFile(mediaUrl);

    const key = `voicemails/${RecordingSid || uuidv4()}.wav`;
    await uploadToS3(audioBuffer, key, 'audio/wav');
    const s3UrlPublicKey = key;

    // Persist voicemail row if DB available
    let voicemailId = null;
    if (pool) {
      const client = await pool.connect();
      try {
        const insertRes = await client.query(`INSERT INTO voicemails (recording_sid, s3_key, s3_url, from_number, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [RecordingSid || null, key, null, From || null, 'uploaded']);
        voicemailId = insertRes.rows[0].id;
      } catch (e) {
        console.warn('Failed to persist voicemail row', e?.message || e);
      } finally {
        client.release();
      }
    }

    const transcript = await transcribeAudio(audioBuffer, key.replace(/^.*\//,''));

    const replyText = await callLLM(transcript);

    let replyAudioBuffer;
    try {
      replyAudioBuffer = await synthesizeSpeechElevenLabs(replyText);
    } catch (e) {
      console.warn('ElevenLabs TTS failed, falling back to no-audio. Error:', e?.message || e);
      replyAudioBuffer = null;
    }

    let replyS3Key = null;
    let presignedUrl = null;
    if (replyAudioBuffer) {
      const replyKey = `replies/${uuidv4()}.mp3`;
      await uploadToS3(replyAudioBuffer, replyKey, 'audio/mpeg');
      replyS3Key = replyKey;
      presignedUrl = getPresignedUrl(replyS3Key);

      // If DB available, save reply_s3_key (not the presigned URL)
      if (pool && voicemailId) {
        const client = await pool.connect();
        try {
          await client.query('UPDATE voicemails SET reply_s3_key=$1, updated_at=now() WHERE id=$2', [replyS3Key, voicemailId]);
        } catch (e) {
          console.warn('Failed to update voicemail with reply key', e?.message || e);
        } finally {
          client.release();
        }
      }
    }

    if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
      const body = presignedUrl
        ? `Nexis AI responded to your voicemail. Reply: ${presignedUrl}`
        : `Nexis AI read your voicemail and replied: ${replyText}`;
      try {
        await twilioClient.messages.create({
          from: process.env.TWILIO_PHONE_NUMBER,
          to: From,
          body,
        });
      } catch (smsErr) {
        console.error('Failed to send SMS', smsErr?.message || smsErr);
      }
    } else {
      console.warn('Twilio not configured; skipping SMS');
    }

    console.log({ s3Key: s3UrlPublicKey, transcript, replyText, replyS3Key, From, voicemailId });
    res.type('text/xml').send('<Response><Say>Thanks, we received your message. We will get back to you shortly.</Say></Response>');
  } catch (err) {
    console.error('webhook error', err?.response?.data || err.message);
    res.status(500).send('error');
  }
});

// Endpoint to generate a presigned URL for a voicemail reply on demand
app.get('/voicemails/:id/reply', async (req, res) => {
  if (!pool) return res.status(501).json({ error: 'Database not configured' });
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const client = await pool.connect();
    try {
      const q = await client.query('SELECT reply_s3_key FROM voicemails WHERE id=$1', [id]);
      if (!q.rows.length || !q.rows[0].reply_s3_key) return res.status(404).json({ error: 'no reply audio' });
      const key = q.rows[0].reply_s3_key;
      const url = getPresignedUrl(key);
      return res.json({ url, expires_in: parseInt(process.env.PRESIGNED_URL_EXPIRY_SECONDS || '3600', 10) });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Failed to generate presigned url', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
});

const required = ['S3_BUCKET','AWS_REGION'];
const missing = required.filter(k=>!process.env[k]);
if (missing.length) console.warn('Missing env vars:', missing.join(', '));

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log(`Nexis AI webhook listening on ${port}`));

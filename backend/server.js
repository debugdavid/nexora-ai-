require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const Twilio = require('twilio');
const twilioLib = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

AWS.config.update({ region: process.env.AWS_REGION });
const s3 = new AWS.S3();

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

function getFullRequestUrl(req) {
  // Prefer HOST env when behind proxy/ngrok to match Twilio signature generation
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
  // Return the key; do not expose public URL
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
    responseType: 'json',
    timeout: 120000
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
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeout: 60000
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
    responseType: 'arraybuffer',
    timeout: 60000
  });
  return Buffer.from(r.data);
}

app.post('/webhooks/voicemail', async (req, res) => {
  try {
    // Validate Twilio signature to ensure request is genuine
    if (!validateTwilioRequest(req)) {
      console.warn('Invalid Twilio signature for request from', req.ip);
      return res.status(403).send('invalid signature');
    }

    const { RecordingUrl, RecordingSid, CallSid, From } = req.body;
    if (!RecordingUrl) return res.status(400).send('no recording');

    const mediaUrl = RecordingUrl.endsWith('.wav') || RecordingUrl.endsWith('.mp3')
      ? RecordingUrl
      : `${RecordingUrl}.wav`;

    // 1) Download audio
    const audioBuffer = await downloadFile(mediaUrl);

    // 2) Store original in S3 (return key)
    const key = `voicemails/${RecordingSid || uuidv4()}.wav`;
    await uploadToS3(audioBuffer, key, 'audio/wav');
    const s3UrlPublicKey = key;

    // 3) Transcribe using OpenAI Whisper
    const transcript = await transcribeAudio(audioBuffer, key.replace(/^.*\//,''));

    // 4) Call LLM to generate reply text
    const replyText = await callLLM(transcript);

    // 5) Synthesize reply audio (ElevenLabs)
    let replyAudioBuffer;
    try {
      replyAudioBuffer = await synthesizeSpeechElevenLabs(replyText);
    } catch (e) {
      console.warn('ElevenLabs TTS failed, falling back to no-audio. Error:', e?.message || e);
      replyAudioBuffer = null;
    }

    // 6) Upload reply audio and send SMS with presigned link (async reply)
    let replyS3Key = null;
    let presignedUrl = null;
    if (replyAudioBuffer) {
      const replyKey = `replies/${uuidv4()}.mp3`;
      await uploadToS3(replyAudioBuffer, replyKey, 'audio/mpeg');
      replyS3Key = replyKey;
      presignedUrl = getPresignedUrl(replyS3Key);
    }

    // Send SMS to caller with the transcript and link to reply audio
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

    console.log({ s3Key: s3UrlPublicKey, transcript, replyText, replyS3Key, From });
    res.type('text/xml').send('<Response><Say>Thanks, we received your message. We will get back to you shortly.</Say></Response>');
  } catch (err) {
    console.error('webhook error', err?.response?.data || err.message);
    res.status(500).send('error');
  }
});

// Basic env validation
const required = ['S3_BUCKET','AWS_REGION'];
const missing = required.filter(k=>!process.env[k]);
if (missing.length) console.warn('Missing env vars:', missing.join(', '));

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log(`Nexis AI webhook listening on ${port}`));

/*
 Background worker for Nexis AI
 - Listens to Bull queue 'nexis-processing'
 - For each job: fetch voicemail row from Postgres, download audio from S3,
   transcribe with OpenAI Whisper, call LLM, synthesize TTS, upload reply,
   send SMS, and update DB status.
*/

require('dotenv').config();
const Queue = require('bull');
const axios = require('axios');
const AWS = require('aws-sdk');
const Twilio = require('twilio');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

AWS.config.update({ region: process.env.AWS_REGION });
const s3 = new AWS.S3();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const processingQueue = new Queue('nexis-processing', redisUrl);

async function transcribeAudioFromS3(s3Key) {
  // Download object from S3
  const obj = await s3.getObject({ Bucket: process.env.S3_BUCKET, Key: s3Key }).promise();
  const buffer = obj.Body;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', buffer, { filename: s3Key });
  form.append('model', 'whisper-1');
  const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() }
  });
  return res.data.text;
}

async function callLLM(prompt) {
  const r = await axios.post('https://api.openai.com/v1/responses', {
    model: process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',
    input: `You are Nexis AI. Reply to the voicemail transcript concisely:\n\n${prompt}`
  }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });

  if (r.data.output && Array.isArray(r.data.output) && r.data.output.length) {
    return r.data.output.map(o => (typeof o === 'string' ? o : (o.content && o.content[0] && o.content[0].text) || '')).join('\n');
  }
  if (r.data.choices && r.data.choices.length) {
    return r.data.choices.map(c => c.text || c.message?.content || '').join('\n');
  }
  return JSON.stringify(r.data);
}

async function synthesizeSpeechElevenLabs(text) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  const voice = process.env.ELEVENLABS_VOICE || 'alloy';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;
  const body = { text };
  const r = await axios.post(url, body, {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    responseType: 'arraybuffer'
  });
  return Buffer.from(r.data);
}

async function uploadReply(buffer) {
  const key = `replies/${uuidv4()}.mp3`;
  await s3.putObject({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: 'audio/mpeg' }).promise();
  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

processingQueue.process(async (job) => {
  const { voicemailId } = job.data;
  console.log('Processing voicemail', voicemailId);
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT * FROM voicemails WHERE id=$1 FOR UPDATE', [voicemailId]);
    if (!res.rows.length) throw new Error('Voicemail not found');
    const row = res.rows[0];
    // update status
    await client.query('UPDATE voicemails SET status=$1, updated_at=now() WHERE id=$2', ['processing', voicemailId]);

    // Transcribe
    const transcript = await transcribeAudioFromS3(row.s3_key);

    // Call LLM
    const replyText = await callLLM(transcript);

    // TTS
    let replyS3Url = null;
    try {
      const replyBuffer = await synthesizeSpeechElevenLabs(replyText);
      replyS3Url = await uploadReply(replyBuffer);
    } catch (tErr) {
      console.warn('TTS failed', tErr?.message || tErr);
    }

    // Send SMS back to caller
    if (twilioClient && process.env.TWILIO_PHONE_NUMBER && row.from_number) {
      const body = replyS3Url ? `Nexis AI responded to your voicemail: ${replyS3Url}` : `Nexis AI replied: ${replyText}`;
      try {
        await twilioClient.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, to: row.from_number, body });
      } catch (smsErr) {
        console.error('Failed to send SMS', smsErr?.message || smsErr);
      }
    }

    // Update DB with results
    await client.query('UPDATE voicemails SET status=$1, transcript=$2, reply_text=$3, reply_s3_url=$4, updated_at=now() WHERE id=$5', ['done', transcript, replyText, replyS3Url, voicemailId]);
    console.log('Processed voicemail', voicemailId);

  } catch (err) {
    console.error('Job error for voicemail', voicemailId, err?.message || err);
    try {
      await client.query('UPDATE voicemails SET status=$1, updated_at=now() WHERE id=$2', ['error', voicemailId]);
    } catch (uErr) {
      console.error('Failed to mark voicemail error', uErr?.message || uErr);
    }
  } finally {
    client.release();
  }
});

console.log('Worker listening for jobs...');

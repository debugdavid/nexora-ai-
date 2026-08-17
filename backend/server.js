require('dotenv').config();
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const Twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

AWS.config.update({ region: process.env.AWS_REGION });
const s3 = new AWS.S3();

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

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
  // Use Responses API (fallback to chat completions style if your account uses it)
  try {
    const body = {
      model: process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',
      input: `You are Nexis AI, an assistant for voicemail messages. Reply succinctly and helpfully to this voicemail transcript:\n\n${prompt}`
    };
    const r = await axios.post('https://api.openai.com/v1/responses', body, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    // Responses API returns 'output' or 'choices' depending on versions; try to find text
    if (r.data.output && Array.isArray(r.data.output) && r.data.output.length) {
      // Concatenate any text parts
      return r.data.output.map(o => (typeof o === 'string' ? o : (o.content && o.content[0] && o.content[0].text) || '')).join('\n');
    }
    if (r.data.choices && r.data.choices.length) {
      return r.data.choices.map(c => c.text || c.message?.content || '').join('\n');
    }
    // Fallback
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
    const { RecordingUrl, RecordingSid, CallSid, From } = req.body;
    if (!RecordingUrl) return res.status(400).send('no recording');

    // Twilio may provide a URL without file extension. Add .wav to be safe.
    const mediaUrl = RecordingUrl.endsWith('.wav') || RecordingUrl.endsWith('.mp3')
      ? RecordingUrl
      : `${RecordingUrl}.wav`;

    // 1) Download audio
    const audioBuffer = await downloadFile(mediaUrl);

    // 2) Store original in S3
    const key = `voicemails/${RecordingSid || uuidv4()}.wav`;
    const s3Url = await uploadToS3(audioBuffer, key, 'audio/wav');

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

    // 6) Upload reply audio and send SMS with link (async reply)
    let replyS3Url = null;
    if (replyAudioBuffer) {
      const replyKey = `replies/${uuidv4()}.mp3`;
      replyS3Url = await uploadToS3(replyAudioBuffer, replyKey, 'audio/mpeg');
    }

    // Send SMS to caller with the transcript and link to reply audio
    if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
      const body = replyS3Url
        ? `Nexis AI responded to your voicemail. Reply: ${replyS3Url}`
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

    // Log metadata (in production, save to DB)
    console.log({ s3Url, transcript, replyText, replyS3Url, From });

    // Respond immediately so Twilio doesn't retry
    res.type('text/xml').send('<Response><Say>Thanks — your message was received. We will text you a reply shortly.</Say></Response>');
  } catch (err) {
    console.error('webhook error', err?.response?.data || err.message);
    res.status(500).send('error');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log(`Nexis AI webhook listening on ${port}`));

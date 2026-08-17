const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

AWS.config.update({ region: process.env.AWS_REGION });
const s3 = new AWS.S3();

async function downloadFile(url) {
  const r = await axios.get(url, { responseType: 'arraybuffer' });
  return r.data;
}

async function uploadToS3(buffer, key, contentType='audio/wav') {
  await s3.putObject({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }).promise();
  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// Placeholder functions - replace with actual vendor SDK calls
async function transcribeAudio(s3Url) {
  return 'Transcribed text from voicemail';
}
async function callLLM(conversationHistory, prompt) {
  return 'Hello — this is Nexis AI. I heard your message and can help with that.';
}
async function synthesizeSpeech(text) {
  return Buffer.from([]);
}

app.post('/webhooks/voicemail', async (req, res) => {
  try {
    const { RecordingUrl, RecordingSid, CallSid, From } = req.body;
    if (!RecordingUrl) return res.status(400).send('no recording');
    const mediaUrl = RecordingUrl + '.wav';
    const audioBuffer = await downloadFile(mediaUrl);
    const key = `voicemails/${RecordingSid || uuidv4()}.wav`;
    const s3Url = await uploadToS3(audioBuffer, key, 'audio/wav');
    const transcript = await transcribeAudio(s3Url);
    const replyText = await callLLM([], transcript);
    const replyAudioBuffer = await synthesizeSpeech(replyText);
    const replyKey = `replies/${uuidv4()}.mp3`;
    const replyS3Url = await uploadToS3(replyAudioBuffer, replyKey, 'audio/mpeg');
    console.log({ s3Url, transcript, replyText, replyS3Url, From });
    res.type('text/xml').send('<Response><Say>Thanks, we received your message. We will get back to you shortly.</Say></Response>');
  } catch (err) {
    console.error(err);
    res.status(500).send('error');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log(`Nexis AI webhook listening on ${port}`));

// Minimal Express server that proxies chat requests to an LLM provider (OpenAI by default)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: 'http://localhost:5173' })); // adjust allowed origin for frontend
app.use(express.json({ limit: '128kb' }));

// Basic rate limiting (tweak for your needs)
const limiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 60, // max requests per IP per minute
});
app.use(limiter);

// POST /api/chat
// body: { messages: [{role: 'user'|'assistant'|'system', content: string}, ...] }
app.post('/api/chat', async (req, res) => {
  try {
    const messages = req.body.messages;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages (array) is required' });
    }

    // Provider config
    const apiKey = process.env.OPENAI_API_KEY;
    const base = process.env.OPENAI_API_BASE || 'https://api.openai.com';
    const model = process.env.OPENAI_MODEL || 'gpt-4';

    // Basic call to OpenAI Chat Completions
    const payload = {
      model,
      messages,
      max_tokens: 1024,
      temperature: 0.7
    };

    const r = await axios.post(`${base}/v1/chat/completions`, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120_000
    });

    const assistantMessage = r.data.choices?.[0]?.message || null;
    return res.json({ reply: assistantMessage, raw: r.data });
  } catch (err) {
    console.error('Chat error', err?.response?.data || err.message || err);
    const message = err?.response?.data || { error: 'LLM provider error' };
    return res.status(500).json({ error: 'LLM provider error', details: message });
  }
});

app.listen(PORT, () => {
  console.log(`Nexora backend listening on http://localhost:${PORT}`);
});

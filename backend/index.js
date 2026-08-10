// Backend with auth + Prisma persistence + email verification & password reset
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendMail } = require('./utils/mailer');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

app.use(helmet());
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json({ limit: '256kb' }));

// Basic rate limiting (tweak for your needs)
const limiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 60, // max requests per IP per minute
});
app.use(limiter);

// Helpers
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

async function getUserFromToken(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2) return null;
  const token = parts[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    return user;
  } catch (e) {
    return null;
  }
}

async function authMiddleware(req, res, next) {
  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

// Create verification token helper
async function createVerificationToken(userId, type = 'verify', ttlMinutes = 60 * 24) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  return await prisma.verificationToken.create({ data: { token, userId, type, expiresAt } });
}

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'User already exists' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, passwordHash } });

    // create verification token and send email
    const v = await createVerificationToken(user.id, 'verify', 60 * 24 * 7); // 7 days
    const verifyUrl = `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/auth/verify?token=${v.token}`;
    const html = `<p>Welcome to Nexora AI. Please verify your email by clicking <a href="${verifyUrl}">this link</a>.</p>`;
    await sendMail(user.email, 'Verify your Nexora AI account', html, `Verify: ${verifyUrl}`);

    const token = generateToken(user);
    return res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const token = generateToken(user);
    return res.json({ token, user: { id: user.id, email: user.email, emailVerified: user.emailVerified } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify email
app.get('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send('token required');
    const v = await prisma.verificationToken.findUnique({ where: { token } });
    if (!v || v.expiresAt < new Date()) return res.status(400).send('invalid or expired token');
    await prisma.user.update({ where: { id: v.userId }, data: { emailVerified: true } });
    await prisma.verificationToken.deleteMany({ where: { userId: v.userId, type: 'verify' } });
    // Redirect to frontend with success
    return res.redirect(`${FRONTEND_URL}/?verified=1`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Verification failed');
  }
});

// Request password reset
app.post('/api/auth/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true }); // don't reveal existence
    const v = await createVerificationToken(user.id, 'reset', 60 * 2); // 2 hours
    const resetUrl = `${FRONTEND_URL}/reset?token=${v.token}`;
    const html = `<p>To reset your Nexora AI password click <a href="${resetUrl}">this link</a>. If you didn't request this, ignore this email.</p>`;
    await sendMail(user.email, 'Reset your Nexora AI password', html, `Reset: ${resetUrl}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not send reset email' });
  }
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token and password required' });
    const v = await prisma.verificationToken.findUnique({ where: { token } });
    if (!v || v.expiresAt < new Date() || v.type !== 'reset') return res.status(400).json({ error: 'invalid or expired token' });
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: v.userId }, data: { passwordHash } });
    await prisma.verificationToken.deleteMany({ where: { userId: v.userId, type: 'reset' } });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not reset password' });
  }
});

// Conversations and chat (unchanged from previous)
app.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const convos = await prisma.conversation.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { index: 'asc' }, take: 50 } }
    });
    res.json({ conversations: convos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load conversations' });
  }
});

app.get('/api/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const convo = await prisma.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { index: 'asc' } } }
    });
    if (!convo || convo.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
    res.json({ conversation: convo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load conversation' });
  }
});

// POST /api/chat
// body: { messages: [{role, content}, ...], conversationId?: string }
app.post('/api/chat', authMiddleware, async (req, res) => {
  try {
    const { messages, conversationId } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages (array) is required' });

    const apiKey = process.env.OPENAI_API_KEY;
    const base = process.env.OPENAI_API_BASE || 'https://api.openai.com';
    const model = process.env.OPENAI_MODEL || 'gpt-4';

    // Call LLM
    const payload = { model, messages, max_tokens: 1024, temperature: 0.7 };

    const r = await axios.post(`${base}/v1/chat/completions`, payload, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120_000
    });

    const assistantMessage = r.data.choices?.[0]?.message || null;

    // Persist conversation and messages
    let convo = null;
    if (conversationId) {
      convo = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!convo || convo.userId !== req.user.id) convo = null;
    }

    if (!convo) {
      // create a title based on first user message
      const firstUser = messages.find(m => m.role === 'user');
      const title = firstUser ? (firstUser.content.substring(0, 60)) : 'Conversation';
      convo = await prisma.conversation.create({ data: { title, userId: req.user.id } });
    }

    // append messages (both user-provided and assistant)
    const existingCount = await prisma.message.count({ where: { conversationId: convo.id } });
    const toCreate = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      toCreate.push({ conversationId: convo.id, role: m.role, content: m.content, index: existingCount + i });
    }
    if (assistantMessage) {
      toCreate.push({ conversationId: convo.id, role: assistantMessage.role || 'assistant', content: assistantMessage.content, index: existingCount + messages.length });
    }

    await prisma.message.createMany({ data: toCreate });
    await prisma.conversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });

    return res.json({ reply: assistantMessage, conversationId: convo.id, raw: r.data });
  } catch (err) {
    console.error('Chat error', err?.response?.data || err.message || err);
    const message = err?.response?.data || { error: 'LLM provider error' };
    return res.status(500).json({ error: 'LLM provider error', details: message });
  }
});

app.listen(PORT, () => {
  console.log(`Nexora backend listening on http://localhost:${PORT}`);
});

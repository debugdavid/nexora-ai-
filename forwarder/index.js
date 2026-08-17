// Small alert forwarder service
// - Receives JSON alerts from Nexis backend
// - Authenticates with a shared secret (query token or x-forwarder-token header)
// - Deduplicates alerts for a short window (configurable)
// - Forwards alerts to configured destinations (Slack, PagerDuty) with basic retry/backoff

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || process.env.FORWARDER_PORT || 8080;
const SECRET = process.env.ALERT_FORWARDER_SECRET;
const SLACK_WEBHOOK = process.env.FORWARD_SLACK_WEBHOOK_URL;
const PAGER_ROUTING_KEY = process.env.PAGERDUTY_ROUTING_KEY;
const DEDUPE_TTL = parseInt(process.env.FORWARDER_DEDUPE_TTL_SECONDS || '300', 10); // seconds

if (!SECRET) {
  console.warn('WARNING: ALERT_FORWARDER_SECRET is not set. Forwarder will reject all requests without a token.');
}

const app = express();
app.use(bodyParser.json({ limit: '64kb' }));

// Simple in-memory dedupe map. Keyed by type+hash(details).
// For production use a Redis set with TTL to dedupe across restarts/instances.
const dedupeMap = new Map();
function makeDedupeKey(type, details) {
  // Simple key construction; stringify details compactly
  try {
    return `${type}:${JSON.stringify(details || {}).slice(0,200)}`;
  } catch (e) {
    return `${type}:unknown`;
  }
}

function authorized(req) {
  const token = (req.get('x-forwarder-token') || req.query.token || '').trim();
  if (!token || !SECRET) return false;
  return token === SECRET;
}

async function postWithRetries(url, payload, opts = {}) {
  const attempts = parseInt(process.env.FORWARDER_RETRY_ATTEMPTS || '3', 10);
  const baseDelay = parseInt(process.env.FORWARDER_RETRY_BASE_MS || '500', 10);
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await axios.post(url, payload, { timeout: opts.timeout || 5000, headers: opts.headers || {} });
      return r;
    } catch (err) {
      const isLast = i === attempts - 1;
      const status = err?.response?.status;
      // If 4xx (except 429) don't retry
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw err;
      }
      if (isLast) throw err;
      const backoff = baseDelay * Math.pow(2, i);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/alerts', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const { type, details, timestamp } = req.body || {};
  if (!type) return res.status(400).json({ ok: false, error: 'missing type' });

  const dedupeKey = makeDedupeKey(type, details);
  const now = Date.now();
  const last = dedupeMap.get(dedupeKey);
  if (last && (now - last) < DEDUPE_TTL * 1000) {
    // duplicate within dedupe window
    return res.json({ ok: true, deduped: true });
  }
  dedupeMap.set(dedupeKey, now);
  // schedule cleanup
  setTimeout(() => dedupeMap.delete(dedupeKey), DEDUPE_TTL * 1000 + 1000);

  const summary = `${type} at ${timestamp || new Date().toISOString()}`;
  const slackText = `*${type}* at ${timestamp || new Date().toISOString()}\n${JSON.stringify(details || {}, null, 2)}`;

  const results = [];

  // Forward to Slack if configured
  if (SLACK_WEBHOOK) {
    try {
      await postWithRetries(SLACK_WEBHOOK, { text: slackText }, { timeout: 5000 });
      results.push({ to: 'slack', ok: true });
    } catch (e) {
      console.error('forwarder: slack forward failed', e?.message || e);
      results.push({ to: 'slack', ok: false, error: e?.message || 'error' });
    }
  }

  // Forward to PagerDuty if configured
  if (PAGER_ROUTING_KEY) {
    const payload = {
      routing_key: PAGER_ROUTING_KEY,
      event_action: 'trigger',
      payload: {
        summary,
        severity: 'warning',
        source: 'nexis-backend',
        custom_details: details || {}
      }
    };
    try {
      await postWithRetries('https://events.pagerduty.com/v2/enqueue', payload, { timeout: 5000, headers: { 'Content-Type': 'application/json' } });
      results.push({ to: 'pagerduty', ok: true });
    } catch (e) {
      console.error('forwarder: pagerduty forward failed', e?.message || e);
      results.push({ to: 'pagerduty', ok: false, error: e?.message || 'error' });
    }
  }

  return res.json({ ok: true, results });
});

app.listen(PORT, () => {
  console.log(`Nexis alert forwarder listening on ${PORT}`);
});

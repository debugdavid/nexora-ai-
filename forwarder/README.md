Forwarder README

This small Express-based service receives alert POSTs from the Nexis backend and
forwards them to one or more configured alerting destinations (Slack, PagerDuty).
It implements simple auth, deduplication, and retries. It's intended as a small
forwarder you can deploy inside your infra; for production use please run behind
TLS, protect the secret, and use a Redis-backed dedupe/rate-limiting store.

Usage
1. Configure environment variables (see .env.forwarder.example).
2. Install deps:
   cd forwarder
   npm install
3. Start:
   npm start

Endpoints
- POST /alerts
  - Authorization: supply token via x-forwarder-token header or ?token=... query
  - Body JSON: { type: 'reply_rate_limited', details: { ip: '1.2.3.4', ... }, timestamp: '...' }
  - Responds: { ok: true, results: [ { to: 'slack', ok: true }, ... ] }
- GET /health
  - Simple healthcheck

Environment variables (.env.forwarder.example)
- ALERT_FORWARDER_SECRET (required) - secret token expected at x-forwarder-token or ?token=...;
- FORWARD_SLACK_WEBHOOK_URL (optional) - Slack incoming webhook URL
- PAGERDUTY_ROUTING_KEY (optional) - PagerDuty Events v2 routing key
- FORWARDER_DEDUPE_TTL_SECONDS (optional, default 300) - dedupe window in seconds
- FORWARDER_RETRY_ATTEMPTS (optional, default 3) - retries when forwarding
- FORWARDER_RETRY_BASE_MS (optional, default 500) - base backoff in ms

Security notes
- Always run behind HTTPS. Protect ALERT_FORWARDER_SECRET in a secrets manager.
- Replace the simple token auth with mTLS or HMAC signing for stronger guarantees.
- For high availability and dedupe across instances, use Redis instead of the in-memory map.

Example
curl -X POST 'https://forwarder.example.com/alerts?token=supersecret' -H 'Content-Type: application/json' -d '{"type":"reply_rate_limited","details":{"ip":"1.2.3.4","count":100}}'

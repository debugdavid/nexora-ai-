# Backend README updates

Alert forwarder
- We include a small alert forwarder at `forwarder/` that receives alert webhooks
  from the Nexis backend and forwards them to Slack and/or PagerDuty.
- Recommended deployment:
  - Deploy the forwarder in your infrastructure (a small node service).
  - Secure ALERT_FORWARDER_SECRET via a secrets manager and expose the forwarder
    only over HTTPS.
  - Set Nexis backend env ALERT_WEBHOOK_URL to the forwarder endpoint:
      https://forwarder.example.com/alerts?token=<ALERT_FORWARDER_SECRET>

This gives you flexibility to format, dedupe, and route alerts to multiple
destinations and to add retries and logging before sending to production alerting systems.

## Docker / docker-compose

This repo includes a Dockerfile and a docker-compose example for the alert forwarder.

Build locally:

  cd forwarder
  docker build -t nexis/alert-forwarder:local .

Run with Docker:

  docker run -e ALERT_FORWARDER_SECRET=supersecret -e FORWARD_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... -p 8080:8080 nexis/alert-forwarder:local

Run with docker-compose (example file included at docker-compose.alert-forwarder.yml):

  # copy the example env and fill secrets
  cp forwarder/.env.forwarder.example forwarder/.env
  # edit forwarder/.env and set ALERT_FORWARDER_SECRET and any forwarding destinations

  docker compose -f docker-compose.alert-forwarder.yml up --build

Healthcheck and logs
- The compose file exposes a healthcheck on /health.
- View logs with:
  docker compose -f docker-compose.alert-forwarder.yml logs -f forwarder

Production notes
- Use a proper secret manager to inject ALERT_FORWARDER_SECRET (do not commit secrets). Use an orchestration platform (Kubernetes, ECS) for production deployments and use the container image built from CI.
- Replace the in-memory dedupe map with Redis for HA across instances.

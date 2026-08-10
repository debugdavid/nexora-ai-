# Nexora AI — ChatGPT-like demo app

This repository contains a starter full-stack scaffold for Nexora AI: a minimal chat application (React frontend + Node/Express backend) that proxies messages to an LLM provider (default: OpenAI).

Quick start (local)
1. Copy .env.example to .env and set OPENAI_API_KEY and optional MODEL.
2. From project root:
   - Using Docker: docker-compose up --build
   - Or run manually:
     - cd backend && npm install && npm run dev
     - cd frontend && npm install && npm run dev

What this demo does
- frontend sends messages to backend /api/chat
- backend calls OpenAI Chat Completions (or another LLM provider) and returns assistant replies

Notes
- This is a starter scaffold. For production: add authentication, rate limiting, streaming, usage/billing, caching, logging, monitoring, and secure key management.

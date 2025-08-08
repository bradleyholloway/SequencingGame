# Sequencing

A lightweight, real-time party game for the web. Each round, players receive a hidden number card (1–10). A prompt defines an axis (e.g., "I just failed my driving test. What did I do wrong? 1: LEAST embarrassing — 10: MOST embarrassing"). Players answer in turn based on their hidden number. The guesser then orders everyone (including themselves) from least to greatest.

This repo contains the product requirements, technical choices, and implementation plan for building the web app.

## Status
Playable MVP loop implemented and runnable locally. Implemented: create/join, token-based reconnect, start round, private number deal, answer submission with timer + countdown, drag-and-drop guess ordering with live preview, reveal animation, host controls (kick, shuffle seats, timer + profanity settings), simple win/loss room stats. Remaining: polish, tests, CI, deployment scripts, optional per-player scoring, and spectator mode. See `docs/` for details.

## Quick Links
- Product Requirements: `docs/PRD.md`
- Tech Stack & Rationale: `docs/TECH_STACK.md`
- Architecture & Data Model: `docs/ARCHITECTURE.md`
- Implementation Plan & Roadmap: `docs/IMPLEMENTATION_PLAN.md`

## Getting Started (dev)
Requirements:
- Node 20+, pnpm
- Vite + React SPA, Socket.IO realtime server (Fastify), Tailwind CSS

Local commands:
- Install: `pnpm install`
- Dev (web): `pnpm --filter sequencing-web dev` (http://localhost:5173)
- Dev (realtime): `pnpm --filter sequencing-realtime dev` (http://localhost:8080/health)
- Test: `pnpm test`
- E2E: `pnpm e2e` (planned)

## License
TBD (recommendation: MIT for open collaboration).

## Deployment (self-hosted Ubuntu ARM + Apache)
See `docs/DEPLOYMENT_SELF_HOSTED.md` for Apache reverse proxy, systemd service, and file layout guidance.

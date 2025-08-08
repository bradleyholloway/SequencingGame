# Sequencing – Implementation Plan & Roadmap

Updated: 2025-08-08

This is a living document. Use checkboxes to track progress. Keep entries small and actionable.

## Milestone 0 – Project Setup
- [x] Initialize repo with pnpm workspaces (two packages): `apps/web` (Vite + React), `services/realtime` (Fastify + Socket.IO)
- [x] Add TypeScript, ESLint, Prettier
- [ ] Add Husky + lint-staged (pre-commit hooks)
- [ ] Setup CI (GitHub Actions): typecheck, lint, unit tests, build SPA artifact

## Milestone 1 – Realtime Foundations
- [x] Scaffold `services/realtime` with Fastify + Socket.IO
- [x] Implement room code generator and in-memory room registry
- [x] Implement events: room:create, room:join, room:state (broadcast)
- [x] Basic disconnect handling (mark player disconnected)
- [x] room:leave event and cleanup on empty room
 - [x] Reconnect semantics (token-based session, resume on reconnect)
 - [ ] Heartbeat/ping and presence (beyond Socket.IO defaults)
 - [x] Basic rate limiting (per-IP window)
 - [ ] Unit tests for room lifecycle

## Milestone 2 – Web App Shell
- [x] Scaffold Vite + React app with Tailwind
- [x] Landing section: Create/Join room
- [x] Lobby view: players list with connection status
- [x] Socket connection and live room state display
 - [x] Host controls (kick, start round, shuffle seats, timer/profanity)
- [ ] E2E smoke test with Playwright

## Milestone 3 – Core Game Loop
- [x] Start round event (server): guesser selection, prompt pick, deal numbers (private deal:self)
 - [x] Phases progression (answering -> guessing -> reveal)
 - [x] Answer submission, timers, and answer-state broadcast
	- [x] Answer submission and answer-state broadcast
	- [x] Answering timer with auto-advance and countdown event
 - [x] Guessing UI (drag-and-drop ordering) with live preview
 - [x] Reveal results (true order vs guessed) with simple animation and room win/loss stat
- [ ] Happy-path e2e test for a full round

## Milestone 4 – Polish & Safety
- [x] Host action: kick
 	- [x] Shuffle seats
 	- [x] Next round
 - [x] Name deduping and avatar colors
 - [x] Basic profanity filter (optional toggle)
- [ ] Mobile touch optimizations and animations
- [ ] Empty/lossy network edge cases (retry, reconnect)

## Milestone 5 – Observability & Deploy
- [ ] Client error boundary + logging
- [ ] Server metrics: rooms, players, round durations
- [ ] Deploy to self-hosted ARM box with Apache
	- [ ] Install Node.js 20 ARM, pnpm
	- [ ] Build SPA and place in Apache DocumentRoot
	- [ ] Create systemd service for realtime Node server on :8080
	- [ ] Configure Apache: serve SPA + ProxyPass /socket.io to :8080 with mod_proxy_wstunnel
	- [ ] Obtain/renew TLS certs (Let’s Encrypt) and enable HTTPS

## Backlog / Future
- [ ] Scoring system and leaderboard
- [ ] Spectator mode
- [ ] Prompt packs (curated), pack management UI
- [ ] Accounts and persistence (Postgres + Prisma)
- [ ] Localization (i18n)
- [ ] Admin tools and moderation automation

## Developer Notes
- Local dev ports: web 5173, realtime 8080 (configure via .env)
- Ensure server is authoritative: do not trust client ordering or numbers
- Keep server events idempotent and validate everything with zod

## Try It (once scaffolded)
Current dev commands:
```powershell
# install deps at repo root
pnpm install

# run realtime service
pnpm --filter ordering-realtime dev

# run web app
pnpm --filter ordering-web dev

# run tests
pnpm test
```

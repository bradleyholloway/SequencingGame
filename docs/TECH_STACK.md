# Sequencing – Tech Stack & Rationale (Self‑Hosted Ubuntu ARM + Apache)

Updated: 2025-08-08

## Summary (optimized for self-hosted ARM, Apache in front)
- Frontend: React + TypeScript + Tailwind CSS (+ class-variance-authority), built with Vite (SPA). Served as static files by Apache.
- Real-time: Socket.IO (WebSocket transport preferred; HTTP long-poll fallback OK through Apache mod_proxy_wstunnel).
- Backend: Node.js 20 LTS on ARM (Fastify + Socket.IO server) running as a systemd service on the same box.
- State: In-memory room state for MVP (single-node). Add Redis only if you later scale beyond one process.
- Data: No persistent DB for MVP. Postgres + Prisma can be added later for accounts/prompt packs.
- Testing: Vitest (unit). Testing Library/Playwright planned.
- Tooling: pnpm, ESLint, Prettier, Husky + lint-staged.
- Deployment: Apache serves the SPA and reverse-proxies /socket.io to the Node service on localhost:8080.

## Why this stack on an ARM microserver?
- Lightweight delivery: Vite outputs static assets; Apache is already installed to serve them efficiently.
- Simple ops: One small Node service behind Apache via reverse proxy, managed by systemd.
- Real-time behind Apache: Socket.IO handles reconnection and proxy quirks; Apache’s mod_proxy_wstunnel supports WebSocket.
- Resource fit: Small memory/CPU footprint; single process holds in-memory rooms without external dependencies.

## Apache integration (at a glance)
- Static: Apache DocumentRoot points to the built SPA (e.g., /var/www/sequencing).
- Proxy: ProxyPass/ProxyPassReverse for /socket.io to http://127.0.0.1:8080/socket.io
- Required modules: proxy, proxy_http, proxy_wstunnel, headers, rewrite.

## Package selection
- UI: react, react-dom, tailwindcss, class-variance-authority
- Client state: zustand (lightweight), optional jotai
- Real-time: socket.io-client (browser) + socket.io (server)
- Server: fastify, socket.io, zod (schemas planned), nanoid
- Tooling: typescript, vite, vitest, eslint, prettier, tsx

## Environments
- Dev: Vite dev server on 5173; WS server on 8080 (CORS allowed in dev)
- Prod (single host): Apache :80/:443 for SPA + reverse proxy to Node :8080

## Resource footprint & constraints
- Target: ARM (e.g., Raspberry Pi or similar). Node 20 LTS has official ARM builds.
- Keep Node heap modest; avoid SSR; SPA keeps CPU low. WS rooms are small (3–10 players).
- Logs to stdout (journald) with rotation via systemd/journal settings.

## Security & privacy
- TLS termination at Apache (Let’s Encrypt or existing certs).
- Same-origin SPA + WS (served from same domain). CORS restricted in dev only.
- Random 6-char room codes (A–Z2–9), join rate limiting, input length caps, optional profanity filter.

## Alternatives considered
- Go backend instead of Node: Lower footprint, single static binary, excellent choice. Kept Node for developer speed and existing JS UI; can migrate later.
- Pure WebSocket (ws/uWebSockets.js): Faster/lighter than Socket.IO but less ergonomic for reconnection/rooms; Socket.IO is sufficient for this scale.
- Next.js: Overkill for SPA; SSR increases complexity and resource usage on the device.

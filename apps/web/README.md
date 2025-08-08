# sequencing-web

Vite + React SPA for Sequencing. Tailwind enabled. Dev server proxies /socket.io to localhost:8080.

## Dev
- Install: pnpm install (at repo root)
- Start web: pnpm --filter apps/web dev

## Build
- pnpm --filter apps/web build
- Output in apps/web/dist (copy to Apache DocumentRoot for prod)

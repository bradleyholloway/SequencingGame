# sequencing-realtime

Fastify + Socket.IO realtime server for Sequencing.

## Dev
- Start: pnpm --filter services/realtime dev
- Health: GET http://localhost:8080/health

## Build/Run
- pnpm --filter services/realtime build
- pnpm --filter services/realtime start

## Deployment
- Run as a systemd service on the ARM host (see docs/DEPLOYMENT_SELF_HOSTED.md)
- Apache reverse proxies /socket.io to http://127.0.0.1:8080/socket.io

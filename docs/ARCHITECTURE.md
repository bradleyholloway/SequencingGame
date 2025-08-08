# Sequencing – Architecture & Data Model (Self‑Hosted Ubuntu ARM + Apache)

Updated: 2025-08-08

## Topology
- Web client: React SPA (built by Vite) served as static files by Apache.
- Real-time service: Fastify + Socket.IO Node process on the same host (e.g., localhost:8080), reverse-proxied by Apache.
- HTTP: Minimal health/info endpoints on the Node service if needed; otherwise SPA handles routes client-side.

Network sketch:
- Apache :80/:443
  - Serves SPA from DocumentRoot (e.g., /var/www/sequencing)
  - Reverse proxy /socket.io to http://127.0.0.1:8080/socket.io via mod_proxy_wstunnel

## Real-time Event Model (current)
- Client -> Server
  - session:hello { token? }
  - room:create { displayName, token? }
  - room:join { roomCode, displayName, token? }
  - room:leave {}
  - settings:update { maxPlayers?, roundTimerSec?, scoringEnabled?, profanityFilterEnabled? } (host)
  - room:kick { playerId } (host)
  - room:shuffleSeats {} (host)
  - round:start { prompt? } (host)
  - answer:submit { text }
  - ordering:preview { ordering: PlayerId[] } (guesser)
  - guesser:order { ordering: PlayerId[] } (guesser)
  - round:end {} (host) — not used by UI (round:next preferred)
  - round:next {} (host)
- Server -> Client
  - session:token { token }
  - room:state { code, hostId, players, settings, phase, currentRound?, stats? }
  - round:started { roundId, guesserId, prompt }
  - deal:self { number }
  - answer:state { answeredIds }
  - ordering:state { ordering }
  - guesser:needed { guesserId }
  - round:result { trueOrder, numbers, submitted, isWin }
  - timer:state { phase, endsAt }
  - error { code, message }

## Phases & State Machine
1) Lobby
2) Answering (timer optional)
3) Guessing
4) Reveal

Transitions:
- Lobby -> Answering (on round:start)
- Answering -> Guessing (when all answered or timer expires)
- Guessing -> Reveal (on guess submission)
- Reveal -> Lobby (after short delay or host continue)

## Data Structures (TypeScript-style)
```ts
// IDs
export type RoomCode = string; // 6 chars A-Z2-9
export type PlayerId = string; // uuid

export type Player = {
  id: PlayerId;
  name: string;
  seat: number; // 0..N-1 around the table
  lastGuessedRound?: number; // undefined means never guesser
  connected: boolean;
  color: string;
};

export type RoomSettings = {
  maxPlayers: number; // <= 10
  scoringEnabled: boolean;
  roundTimerSec?: number;
  profanityFilterEnabled?: boolean;
};

export type Round = {
  id: string;
  index: number; // 0-based
  guesserId: PlayerId;
  prompt: string;
  numbers: Record<PlayerId, number>; // server-only; per-player reveal via deal:self
  answers: Record<PlayerId, string>; // empty until submitted
  orderingGuess?: PlayerId[];
  orderingPreview?: PlayerId[];
  participants: PlayerId[];
};

export type RoomState = {
  code: RoomCode;
  hostId: PlayerId;
  players: Player[];
  settings: RoomSettings;
  phase: "lobby" | "answering" | "guessing" | "reveal";
  currentRound?: Round;
  stats?: { wins: number; losses: number };
};
```

## Guesser Selection Algorithm
- Prefer connected players who have never guessed; choose randomly among them.
- Otherwise, pick the connected player with the smallest lastGuessedRound index (ascending).

## Seat Order
- Deterministic seating 0..N-1; used as the default ordering layout for guessing and previews.

## Scaling Notes
- Single instance (MVP): in-memory rooms map keyed by RoomCode in the Node process.
- Horizontal scale: add Redis pub/sub + Socket.IO Redis adapter to fan out events across processes; then run multiple Node instances behind Apache (or separate LB), still proxying /socket.io.
- Persistence: add Postgres (Prisma) for accounts/prompt packs if needed.

## Apache Considerations
- Enable modules: proxy, proxy_http, proxy_wstunnel, headers, rewrite.
- Ensure ProxyPass and ProxyPassReverse for /socket.io, and Rewrite for WebSocket Upgrade headers if needed.
- Serve SPA with fallback to /index.html for client-side routing (try_files equivalent via Apache config).

## Error Handling
- Basic runtime checks; consider zod schemas for stricter validation in future.
- Unknown roomCode -> error "ROOM_NOT_FOUND"
- Room full -> error "ROOM_FULL"
- Invalid phase transitions are ignored with warning

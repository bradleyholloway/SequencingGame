# Sequencing – Product Requirements Document (PRD)

Last updated: 2025-08-08
Owner: You (Project Lead)
Status: In progress (MVP loop implemented; polish and tests pending)

## 1. Overview
Sequencing is a real-time web party game. Each player is dealt a hidden number card (1–10). A prompt defines an axis. Players describe their number via an answer; the guesser then orders everyone from least to greatest.

### Goals
- Fast, zero-friction play on mobile or desktop
- No login required; join via link or 4–6 letter room code
- Low-latency real-time experience for 3–10 players

### Non-goals (MVP)
- Profiles, friends, or social graph
- Monetization, store, or complex progression

## 2. Users & Personas
- Host: creates room, starts rounds, manages settings
- Players: join room, view own card, submit answers
- Guesser (rotating role): after hearing answers, submits ordering guess
- Spectators (optional/later): read-only presence

## 3. Core Gameplay Loop (MVP)
1) Host creates a room and shares the join link/code.
2) Players join, pick a display name (and optional avatar color).
3) Start round: all players are dealt a hidden number in [1–10]. If player count > 10, cap at 10 and prevent start; if < 3, prevent start (needs meaningful ordering).
4) Guesser selection: player who was guesser longest ago; if none have been guesser yet, choose randomly among never-selected players.
5) Prompt: shown to all players (the axis text). Example: "I just failed my driving test. What did I do wrong? (1=Least embarrassing, 10=Most embarrassing)".
6) Turn order: clockwise from guesser’s left (deterministic seat order assigned at join or randomized at round start). Each player submits an answer text.
7) After all answers are submitted, the guesser orders all players (including self) from least to greatest.
8) Result: Reveal true ordering and (optional) scoring feedback. Proceed to next round.

## 4. Functional Requirements
Current progress (Aug 2025):
- Implemented: Room create/join, token-based reconnect, lobby presence updates, host kick, shuffle seats, start round, private number dealing, answering phase with countdown, answer-state updates, guessing with drag-and-drop and live preview, reveal with correctness feedback, basic room stats (wins/losses).
- Pending: Optional scoring, spectator handling during active rounds, moderation filter packs, CI/tests, deploy automation.

- Room lifecycle
  - Create room with code; join via code or link
  - Display list of connected players and seat order
  - Host controls: start/next round, kick player, shuffle seats, update timer/profanity settings
  - Reconnect handling: players can rejoin and recover state (token-based session)
- Round mechanics
  - Deal hidden numbers (1–10) randomly without duplicates; if players > 10, starting is disallowed
  - Show prompt to all; hide numbers at all times except individual self-view
  - Answer submission with minimal validation (1–200 chars); optional profanity filter
  - Guesser ordering UI supporting drag-and-drop of player tiles; live ordering preview broadcast
  - Reveal phase showing true order and correctness; simple win/loss stats at room scope
- Guesser selection
  - Track per-player last guessed round index
  - On new round: choose player with minimal last-guessed index; tie-breaker random among "never"; then by oldest timestamp if needed
- Scoring (optional MVP toggle; default off)
  - Guesser: +1 per correctly placed player; perfect order bonus (+N)
  - Players: +1 if within ±1 of true position
- Settings
  - Player cap (max 10), round timer (e.g., 90s for answers), profanity filter on/off; scoring toggle planned
  - Prompt source: built-in pack(s) vs custom prompts (host curated)
- Moderation
  - Host can remove a player; optional profanity filter (simple regex mask)

## 5. Non-Functional Requirements
- Real-time: p95 interaction latency < 300 ms on broadband
- Availability: rooms are in-memory; empty rooms are cleaned up promptly; session tokens persist up to 7 days
- Privacy: no account needed; only ephemeral display names stored; no numbers shown to others
- Accessibility: keyboard navigation, sufficient contrast, readable on small screens
- Internationalization: English only for MVP; text externalized for future i18n
- Observability: client error reporting, server logs, simple metrics (rooms, players, round duration)

## 6. Edge Cases
- Player disconnects mid-round: mark as disconnected; allow rejoin; if guesser disconnects, pause round with countdown
- Late join during active round: allowed but hidden number dealt at next round; spectator view for current round
- Duplicate names: allow but add discriminator suffix (e.g., #2)
- Timeouts: if player doesn’t submit an answer before timer, auto-mark as "No answer" and continue
- Small lobby: block start if < 3 players; display reason

## 7. Success Metrics (MVP)
- Session completion rate (>70% of rooms play ≥1 completed round)
- Time-to-first-round (<60 seconds from first player joining)
- Average concurrent players per room (3–8)
- Stability: <2% disconnects per 10 minutes

## 8. Open Questions
- Should prompts be curated packs vs fully custom? MVP: both, with basic built-in sample pack
- Should we include voice? MVP: no; text-only answers
- Regional moderation needs? MVP: simple toggleable filter

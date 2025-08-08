import Fastify from 'fastify'
import { Server as IOServer } from 'socket.io'
import { customAlphabet, nanoid } from 'nanoid'

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const nano = customAlphabet(alphabet, 6)

function createRoomCode() { return nano() }

type PlayerId = string

type Player = {
  id: PlayerId
  name: string
  seat: number
  lastGuessedRound?: number
  connected: boolean
  color: string
}

type RoomSettings = {
  maxPlayers: number
  scoringEnabled: boolean
  roundTimerSec?: number
  profanityFilterEnabled?: boolean
}

type Round = {
  id: string
  index: number
  guesserId: PlayerId
  prompt: string
  numbers: Record<PlayerId, number>
  answers: Record<PlayerId, string>
  orderingGuess?: PlayerId[]
  participants: PlayerId[]
  orderingPreview?: PlayerId[]
}

type RoomState = {
  code: string
  hostId: PlayerId
  players: Player[]
  settings: RoomSettings
  phase: 'lobby' | 'answering' | 'guessing' | 'reveal'
  currentRound?: Round
  stats?: { wins: number; losses: number }
}

type Room = RoomState & {
  sockets: Map<PlayerId, string> // playerId -> socketId
  roundCounter: number
  timers?: {
    answering?: NodeJS.Timeout
    answeringTick?: NodeJS.Timeout
    answeringEndsAt?: number
  }
}

const rooms = new Map<string, Room>()
const sessions = new Map<string, { roomCode: string, playerId: PlayerId, issuedAt: number }>()

// Basic per-IP rate limit (windowed counter)
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 20 // ops per window
const ipHits = new Map<string, { count: number; windowStart: number }>()
function rateCheck(ip: string | undefined): boolean {
  const key = ip || 'unknown'
  const now = Date.now()
  const rec = ipHits.get(key)
  if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
    ipHits.set(key, { count: 1, windowStart: now })
    return true
  }
  if (rec.count >= RATE_LIMIT) return false
  rec.count += 1
  return true
}

// Session token TTL
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function seatIndexForNewPlayer(players: Player[]): number {
  const seats = new Set(players.map(p => p.seat))
  for (let i = 0; i <= players.length; i++) if (!seats.has(i)) return i
  return players.length
}

const COLOR_PALETTE = [
  '#ef4444','#f97316','#eab308','#84cc16','#22c55e','#14b8a6','#06b6d4','#3b82f6','#8b5cf6','#db2777'
]
function colorForId(id: string): string {
  let h = 0
  for (let i=0;i<id.length;i++) { h = (h*31 + id.charCodeAt(i)) >>> 0 }
  return COLOR_PALETTE[h % COLOR_PALETTE.length]
}

function ensureUniqueName(room: Room, desired: string): string {
  const base = desired.trim() || 'Player'
  const names = new Set(room.players.map(p => p.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} #${n}`)) n++
  return `${base} #${n}`
}

const PROFANE = [/\bshit\b/i,/\bfuck\b/i,/\bass\b/i,/\bcunt\b/i,/\bbitch\b/i]
function filterProfanity(text: string): string {
  let out = text
  for (const re of PROFANE) out = out.replace(re, (m) => '*'.repeat(m.length))
  return out
}

function publicRoomState(room: Room): RoomState {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players,
    settings: room.settings,
    phase: room.phase,
  stats: room.stats,
    currentRound: room.currentRound ? {
      ...room.currentRound,
      numbers: {} as any,
      // Expose answers during guessing/reveal for UI
      answers: (room.phase === 'guessing' || room.phase === 'reveal') ? room.currentRound.answers : ({} as any),
    } : undefined,
  }
}

const BUILTIN_PROMPTS: string[] = [
  'I just failed my driving test. What did I do wrong? (1 = Least embarrassing, 10 = Most embarrassing)',
  'How spicy is this curry? (1 = Mild, 10 = Fire)',
  'How early would I arrive to a party? (1 = Very late, 10 = Very early)',
  'How likely am I to survive a zombie apocalypse? (1 = Not at all, 10 = Very likely)',
]

function pickPrompt(custom?: string): string {
  if (custom && String(custom).trim().length > 0) return String(custom).trim()
  return BUILTIN_PROMPTS[Math.floor(Math.random() * BUILTIN_PROMPTS.length)]
}

function chooseGuesser(room: Room): PlayerId {
  const never = room.players.filter(p => p.connected && p.lastGuessedRound === undefined)
  if (never.length > 0) {
    const idx = Math.floor(Math.random() * never.length)
    return never[idx].id
  }
  // pick player with the smallest lastGuessedRound
  const sorted = [...room.players].filter(p => p.connected && p.lastGuessedRound !== undefined)
    .sort((a, b) => (a.lastGuessedRound! - b.lastGuessedRound!))
  return (sorted[0] ?? room.players[0]).id
}

function dealNumbers(room: Room, players: Player[]): Record<PlayerId, number> {
  const deck = Array.from({ length: 10 }, (_, i) => i + 1) // 1..10
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }
  const numbers: Record<PlayerId, number> = {}
  players.forEach((p, i) => { numbers[p.id] = deck[i] })
  return numbers
}

async function main() {
  const fastify = Fastify({ logger: false })
  const io = new IOServer(fastify.server, { path: '/socket.io', serveClient: false, transports: ['websocket', 'polling'] })

  fastify.get('/health', async () => ({ ok: true }))

  io.on('connection', (socket) => {
    let playerId: string | null = null
    let roomCode: string | null = null

    function getOrIssueToken(token?: string): string {
      if (token && typeof token === 'string' && token.length >= 8) return token
      const t = nanoid(21)
      socket.emit('session:token', { token: t })
      return t
    }

    function emitState() {
      if (!roomCode) return
      const room = rooms.get(roomCode)
      if (!room) return
      io.to(room.code).emit('room:state', publicRoomState(room))
    }

    socket.on('session:hello', ({ token }: { token?: string } = {}) => {
      const t = getOrIssueToken(token)
      const s = sessions.get(t)
      if (!s) return
      // expire tokens
      if (Date.now() - s.issuedAt > TOKEN_TTL_MS) { sessions.delete(t); return }
      const room = rooms.get(s.roomCode)
      if (!room) return
      const p = room.players.find(pp => pp.id === s.playerId)
      if (!p) return
      playerId = p.id
      roomCode = room.code
      room.sockets.set(p.id, socket.id)
      socket.join(room.code)
      p.connected = true
      emitState()
      if (room.currentRound && room.currentRound.numbers[p.id] != null) {
        socket.emit('deal:self', { number: room.currentRound.numbers[p.id] })
      }
    })

    socket.on('room:create', ({ displayName, token }: { displayName?: string, token?: string }) => {
      if (!rateCheck(socket.handshake.address)) return socket.emit('error', { code: 'RATE_LIMITED', message: 'Too many requests' })
      const t = getOrIssueToken(token)
      const code = createRoomCode()
      const player: Player = { id: t, name: String(displayName || 'Host'), seat: 0, connected: true, color: colorForId(t) }
      const room: Room = {
        code,
        hostId: player.id,
        players: [player],
        settings: { maxPlayers: 10, scoringEnabled: false, roundTimerSec: 90, profanityFilterEnabled: false },
        phase: 'lobby',
  stats: { wins: 0, losses: 0 },
        sockets: new Map([[player.id, socket.id]]),
        roundCounter: 0,
      }
  rooms.set(code, room)
  sessions.set(t, { roomCode: code, playerId: player.id, issuedAt: Date.now() })
      playerId = player.id
      roomCode = code
      socket.join(code)
      emitState()
    })

    socket.on('room:join', ({ roomCode: code, displayName, token }: { roomCode: string, displayName?: string, token?: string }) => {
      if (!rateCheck(socket.handshake.address)) return socket.emit('error', { code: 'RATE_LIMITED', message: 'Too many requests' })
      const t = getOrIssueToken(token)
      const room = rooms.get(String(code).toUpperCase())
      if (!room) return socket.emit('error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' })
      if (room.players.length >= room.settings.maxPlayers) return socket.emit('error', { code: 'ROOM_FULL', message: 'Room is full' })
      const seat = seatIndexForNewPlayer(room.players)
      const desired = String(displayName || 'Player')
      const unique = ensureUniqueName(room, desired)
      const player: Player = { id: t, name: unique, seat, connected: true, color: colorForId(t) }
      room.players.push(player)
      room.sockets.set(player.id, socket.id)
      sessions.set(t, { roomCode: room.code, playerId: player.id, issuedAt: Date.now() })
      playerId = player.id
      roomCode = room.code
      socket.join(room.code)
      emitState()
    })

    socket.on('settings:update', (patch: Partial<RoomSettings>) => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room) return
      if (playerId !== room.hostId) return socket.emit('error', { code: 'NOT_HOST', message: 'Only host can update settings' })
      room.settings = { ...room.settings, ...patch }
      emitState()
    })

    socket.on('room:leave', () => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room) return
      // remove player
      const index = room.players.findIndex(p => p.id === playerId)
      if (index !== -1) {
        room.players.splice(index, 1)
      }
      room.sockets.delete(playerId)
      socket.leave(room.code)
      // reassign host if needed
      if (room.hostId === playerId) {
        room.hostId = room.players[0]?.id ?? room.hostId
      }
      // cleanup empty room
      if (room.players.length === 0) {
        rooms.delete(room.code)
      } else {
        emitState()
      }
      // clear local refs
      playerId = null
      roomCode = null
    })

  socket.on('round:start', ({ prompt }: { prompt?: string } = {}) => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room) return
      if (playerId !== room.hostId) return socket.emit('error', { code: 'NOT_HOST', message: 'Only host can start round' })
      const activePlayers = room.players.filter(p => p.connected)
      if (activePlayers.length < 3) return socket.emit('error', { code: 'NOT_ENOUGH_PLAYERS', message: 'At least 3 players required' })
      if (activePlayers.length > 10) return socket.emit('error', { code: 'TOO_MANY_PLAYERS', message: 'Max 10 players' })

      const guesserId = chooseGuesser(room)
      const roundId = `${room.code}-${room.roundCounter + 1}`
      const chosenPrompt = pickPrompt(prompt)
      const numbers = dealNumbers(room, activePlayers)
      const answers: Record<PlayerId, string> = {}
      activePlayers.forEach(p => answers[p.id] = '')
      room.currentRound = {
        id: roundId,
        index: room.roundCounter,
        guesserId,
        prompt: chosenPrompt,
        numbers,
        answers,
        participants: activePlayers.map(p => p.id),
      }
      room.phase = 'answering'
      room.roundCounter += 1

      // notify players of their number privately
      for (const p of activePlayers) {
        const sid = room.sockets.get(p.id)
        if (sid) io.to(sid).emit('deal:self', { number: numbers[p.id] })
      }
      // announce round started
      io.to(room.code).emit('round:started', { roundId, guesserId, prompt: chosenPrompt })
      // start answering timer if configured
      const dur = room.settings.roundTimerSec ?? 90
      const endsAt = Date.now() + dur * 1000
      room.timers = room.timers || {}
      room.timers.answeringEndsAt = endsAt
      if (room.timers.answering) { clearTimeout(room.timers.answering); room.timers.answering = undefined }
      if (room.timers.answeringTick) { clearInterval(room.timers.answeringTick); room.timers.answeringTick = undefined }
      room.timers.answering = setTimeout(() => {
        // auto-advance to guessing if still in answering
        const r = rooms.get(room.code)
        if (!r || r.phase !== 'answering' || !r.currentRound) return
        const answeredIds = Object.entries(r.currentRound.answers).filter(([_, v]) => v && v.length > 0).map(([k]) => k)
        if (answeredIds.length < r.currentRound.participants.length) {
          r.phase = 'guessing'
          io.to(r.code).emit('guesser:needed', { guesserId: r.currentRound.guesserId })
          // initialize preview ordering by seat
          const bySeat = r.players
            .filter(p => r.currentRound!.participants.includes(p.id))
            .sort((a,b)=>a.seat-b.seat)
            .map(p=>p.id)
          r.currentRound.orderingPreview = bySeat
          io.to(r.code).emit('ordering:state', { ordering: bySeat })
          emitState()
        }
      }, dur * 1000)
      room.timers.answeringTick = setInterval(() => {
        const r = rooms.get(room.code)
        if (!r || r.phase !== 'answering' || !r.timers?.answeringEndsAt) return
        io.to(r.code).emit('timer:state', { phase: 'answering', endsAt: r.timers.answeringEndsAt })
      }, 1000)
      emitState()
    })

    socket.on('answer:submit', ({ text }: { text: string }) => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room || room.phase !== 'answering' || !room.currentRound) return
      const round = room.currentRound
      if (!round.participants.includes(playerId)) return
      let cleaned = String(text ?? '').trim().slice(0, 200)
      if (room.settings.profanityFilterEnabled) cleaned = filterProfanity(cleaned)
      round.answers[playerId] = cleaned
      // broadcast answered ids
      const answeredIds = Object.entries(round.answers).filter(([_, v]) => v && v.length > 0).map(([k]) => k)
      io.to(room.code).emit('answer:state', { answeredIds })
      // move to guessing when all answered
      if (answeredIds.length === round.participants.length) {
        room.phase = 'guessing'
        // stop answering timer
        if (room.timers?.answering) { clearTimeout(room.timers.answering); room.timers.answering = undefined }
        if (room.timers?.answeringTick) { clearInterval(room.timers.answeringTick); room.timers.answeringTick = undefined }
        io.to(room.code).emit('guesser:needed', { guesserId: round.guesserId })
        // initialize preview ordering by seat
        const bySeat = room.players
          .filter(p => round.participants.includes(p.id))
          .sort((a,b)=>a.seat-b.seat)
          .map(p=>p.id)
        round.orderingPreview = bySeat
        io.to(room.code).emit('ordering:state', { ordering: bySeat })
        emitState()
      }
    })

    socket.on('guesser:order', ({ ordering }: { ordering: PlayerId[] }) => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room || room.phase !== 'guessing' || !room.currentRound) return
      const round = room.currentRound
      if (playerId !== round.guesserId) return socket.emit('error', { code: 'NOT_GUESSER', message: 'Only guesser can submit ordering' })
      // validate ordering
      const setA = new Set(ordering)
      const setB = new Set(round.participants)
      if (setA.size !== setB.size || round.participants.some(id => !setA.has(id))) {
        return socket.emit('error', { code: 'INVALID_ORDERING', message: 'Ordering must include all participants exactly once' })
      }
      round.orderingGuess = ordering.slice()
    // compute true order
    const trueOrder = [...round.participants].sort((a, b) => round.numbers[a] - round.numbers[b])
      room.phase = 'reveal'
  // stop answering timer if still running (safety)
  if (room.timers?.answering) { clearTimeout(room.timers.answering); room.timers.answering = undefined }
  if (room.timers?.answeringTick) { clearInterval(room.timers.answeringTick); room.timers.answeringTick = undefined }
  // compute win and update stats
  const isWin = round.orderingGuess.length === trueOrder.length && round.orderingGuess.every((id, i) => id === trueOrder[i])
  if (!room.stats) room.stats = { wins: 0, losses: 0 }
  if (isWin) room.stats.wins += 1; else room.stats.losses += 1
  io.to(room.code).emit('round:result', { trueOrder, numbers: round.numbers, submitted: round.orderingGuess, isWin })
      emitState()

  // update guesser history; stay in reveal until host advances
  const g = room.players.find(p => p.id === round.guesserId)
  if (g) g.lastGuessedRound = round.index
    })

    socket.on('ordering:preview', ({ ordering }: { ordering: PlayerId[] }) => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room || room.phase !== 'guessing' || !room.currentRound) return
      const round = room.currentRound
      if (playerId !== round.guesserId) return
      // validate ordering covers all participants
      const setA = new Set(ordering)
      const setB = new Set(round.participants)
      if (setA.size !== setB.size || round.participants.some(id => !setA.has(id))) return
      round.orderingPreview = ordering.slice()
      io.to(room.code).emit('ordering:state', { ordering: round.orderingPreview })
    })

    socket.on('room:shuffleSeats', () => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room) return
      if (playerId !== room.hostId) return socket.emit('error', { code: 'NOT_HOST', message: 'Only host can shuffle seats' })
      const seats = [...room.players]
      for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [seats[i], seats[j]] = [seats[j], seats[i]] }
      seats.forEach((p, i) => { p.seat = i })
      emitState()
    })

    socket.on('round:end', () => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room) return
      if (playerId !== room.hostId) return socket.emit('error', { code: 'NOT_HOST', message: 'Only host can end round' })
      // stop timers
      if (room.timers?.answering) { clearTimeout(room.timers.answering); room.timers.answering = undefined }
      if (room.timers?.answeringTick) { clearInterval(room.timers.answeringTick); room.timers.answeringTick = undefined }
      room.currentRound = undefined
      room.phase = 'lobby'
      emitState()
    })

    socket.on('round:next', () => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room) return
      if (playerId !== room.hostId) return socket.emit('error', { code: 'NOT_HOST', message: 'Only host can advance' })
      // Only advance from reveal
      if (room.phase !== 'reveal') return
      room.currentRound = undefined
      room.phase = 'lobby'
      emitState()
    })

  socket.on('disconnect', () => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room) return
      const p = room.players.find(p => p.id === playerId)
      if (p) p.connected = false
      emitState()
    })

    socket.on('room:kick', ({ playerId: targetId }: { playerId: string }) => {
      if (!roomCode || !playerId) return
      const room = rooms.get(roomCode)
      if (!room) return
      if (playerId !== room.hostId) return socket.emit('error', { code: 'NOT_HOST', message: 'Only host can kick' })
      if (targetId === room.hostId) return socket.emit('error', { code: 'CANNOT_KICK_HOST', message: 'Cannot kick host' })
      const idx = room.players.findIndex(p => p.id === targetId)
      if (idx === -1) return
      const [removed] = room.players.splice(idx, 1)
      const sid = room.sockets.get(removed.id)
      if (sid) io.sockets.sockets.get(sid)?.leave(room.code)
      room.sockets.delete(removed.id)
      // End round if participants changed mid-round (MVP: return to lobby)
      if (room.currentRound) { room.currentRound = undefined; room.phase = 'lobby' }
      emitState()
    })
  })

  // Periodic cleanup for old sessions and empty rooms
  setInterval(() => {
    const now = Date.now()
    for (const [token, s] of sessions) {
      if (now - s.issuedAt > TOKEN_TTL_MS) sessions.delete(token)
    }
    for (const [code, room] of rooms) {
      if (room.players.length === 0) rooms.delete(code)
    }
  }, 60_000)

  const port = Number(process.env.PORT || 8080)
  await fastify.listen({ port, host: '0.0.0.0' })
  // eslint-disable-next-line no-console
  console.log(`[realtime] listening on ${port}`)
}

main().catch(err => { console.error(err); process.exit(1) })

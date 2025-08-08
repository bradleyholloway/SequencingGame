import React, { useEffect, useMemo, useState } from 'react'
import { io, Socket } from 'socket.io-client'

// naive local store just for MVP demo
function useSocket() {
  const socket = useMemo<Socket>(() => io('/', { path: '/socket.io', autoConnect: false }), [])
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    function onConnect() { setConnected(true) }
    function onDisconnect() { setConnected(false) }
    function onSession(p: { token: string }) { try { localStorage.setItem('ordering_token', p.token) } catch {}
      // resume immediately after receiving a new token
      socket.emit('session:hello', { token: p.token })
    }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('session:token', onSession)
    socket.connect()
    // Attempt resume
    try { const tok = localStorage.getItem('ordering_token'); if (tok) socket.emit('session:hello', { token: tok }) } catch {}
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.disconnect() }
  }, [socket])
  return { socket, connected }
}

type RoomState = {
  code: string
  hostId: string
  players: { id: string; name: string; seat: number; connected: boolean; color: string }[]
  settings: { maxPlayers: number; scoringEnabled: boolean; roundTimerSec?: number; profanityFilterEnabled?: boolean }
  phase: 'lobby' | 'answering' | 'guessing' | 'reveal'
  currentRound?: { id: string; index: number; guesserId: string; prompt: string; participants: string[]; answers?: Record<string, string> }
  stats?: { wins: number; losses: number }
}

// Map server palette hex colors to Tailwind bg classes to avoid inline styles
function colorClass(hex: string): string {
  switch ((hex || '').toLowerCase()) {
    case '#ef4444': return 'bg-red-500'
    case '#f97316': return 'bg-orange-500'
    case '#eab308': return 'bg-yellow-500'
    case '#84cc16': return 'bg-lime-500'
    case '#22c55e': return 'bg-green-500'
    case '#14b8a6': return 'bg-teal-500'
    case '#06b6d4': return 'bg-cyan-500'
    case '#3b82f6': return 'bg-blue-500'
    case '#8b5cf6': return 'bg-violet-500'
    case '#db2777': return 'bg-pink-600'
    default: return 'bg-neutral-500'
  }
}

// Choose grid columns (1..10) to make ordering lists fill container width
function gridColsClass(n: number): string {
  const c = Math.max(1, Math.min(10, n || 1))
  switch (c) {
    case 1: return 'grid-cols-1'
    case 2: return 'grid-cols-2'
    case 3: return 'grid-cols-3'
    case 4: return 'grid-cols-4'
    case 5: return 'grid-cols-5'
    case 6: return 'grid-cols-6'
    case 7: return 'grid-cols-7'
    case 8: return 'grid-cols-8'
    case 9: return 'grid-cols-9'
    default: return 'grid-cols-10'
  }
}

export default function App() {
  const { socket, connected } = useSocket()
  const [displayName, setDisplayName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [state, setState] = useState<RoomState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [myNumber, setMyNumber] = useState<number | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [myAnswer, setMyAnswer] = useState('')
  const [answeredIds, setAnsweredIds] = useState<string[]>([])
  const [ordering, setOrdering] = useState<string[]>([])
  const [result, setResult] = useState<{ trueOrder: string[]; numbers: Record<string, number>; submitted?: string[]; isWin?: boolean } | null>(null)
  const [revealIndex, setRevealIndex] = useState<number>(-1)
  const [revealWin, setRevealWin] = useState<boolean | null>(null)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [timerSec, setTimerSec] = useState<number | ''>('')
  const [profanity, setProfanity] = useState<boolean>(false)
  const [myId, setMyId] = useState<string | null>(null)
  const [now, setNow] = useState<number>(Date.now())
  const [orderingPreview, setOrderingPreview] = useState<string[]>([])
  const progressRef = React.useRef<HTMLDivElement | null>(null)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)

  useEffect(() => {
    const onState = (payload: RoomState) => { setState(payload); setError(null) }
    const onError = (e: { code: string; message: string }) => setError(`${e.code}: ${e.message}`)
  const onDeal = (d: { number: number }) => setMyNumber(d.number)
  const onStarted = (_: any) => { setMyAnswer(''); setAnsweredIds([]); setOrdering([]); setResult(null) }
  const onAnswerState = (p: { answeredIds: string[] }) => setAnsweredIds(p.answeredIds)
  const onResult = (p: { trueOrder: string[]; numbers: Record<string, number>; submitted?: string[]; isWin?: boolean }) => { setResult(p); setRevealIndex(-1); setRevealWin(null) }
  const onTimer = (p: { phase: string; endsAt: number }) => setEndsAt(p.endsAt)
    socket.on('room:state', onState)
    socket.on('error', onError)
  socket.on('deal:self', onDeal)
  socket.on('round:started', onStarted)
  socket.on('answer:state', onAnswerState)
  socket.on('round:result', onResult)
  socket.on('timer:state', onTimer)
  const onSessionToken = (p: { token: string }) => { try { setMyId(p.token) } catch {} }
  socket.on('session:token', onSessionToken)
  const onOrderingState = (p: { ordering: string[] }) => setOrderingPreview(p.ordering)
  socket.on('ordering:state', onOrderingState)
  return () => { socket.off('room:state', onState); socket.off('error', onError); socket.off('deal:self', onDeal); socket.off('round:started', onStarted); socket.off('answer:state', onAnswerState); socket.off('round:result', onResult); socket.off('timer:state', onTimer); socket.off('session:token', onSessionToken); socket.off('ordering:state', onOrderingState) }
  }, [socket])

  function createRoom() {
    if (!displayName) return setError('Enter a name')
  const token = (()=>{ try { return localStorage.getItem('ordering_token') } catch { return null } })()
  socket.emit('room:create', { displayName, token })
  }
  function joinRoom() {
    if (!displayName || !roomCode) return setError('Enter name and room code')
  const token = (()=>{ try { return localStorage.getItem('ordering_token') } catch { return null } })()
  socket.emit('room:join', { roomCode: roomCode.trim().toUpperCase(), displayName, token })
  }
  function leaveRoom() {
    socket.emit('room:leave')
    setState(null); setMyNumber(null); setRoomCode('')
  }
  async function copyRoomLink() {
    const code = state?.code || roomCode
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopyMsg('Copied!')
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = code
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopyMsg('Copied!')
      } catch {}
    }
    window.setTimeout(() => setCopyMsg(null), 1200)
  }
  function startRound() {
    socket.emit('round:start', { prompt: customPrompt })
    setCustomPrompt('')
  }
  function kick(pid: string) {
    socket.emit('room:kick', { playerId: pid })
  }
  function submitAnswer() {
    socket.emit('answer:submit', { text: myAnswer })
  }
  function submitOrdering() {
    socket.emit('guesser:order', { ordering })
  }
  function shuffleSeats() { socket.emit('room:shuffleSeats') }
  function endRound() { socket.emit('round:end') }
  function updateSettings(patch: Partial<RoomState['settings']>) { socket.emit('settings:update', patch) }

  useEffect(() => {
    const handler = () => socket.emit('room:leave')
    window.addEventListener('beforeunload', handler)
  // initialize myId from localStorage
  try { const tok = localStorage.getItem('ordering_token'); if (tok) setMyId(tok) } catch {}
  return () => window.removeEventListener('beforeunload', handler)
  }, [socket])

  // Initialize ordering when becoming guesser; clear countdown when leaving answering
  useEffect(() => {
    if (!state) return
    // sync local settings controls
    setTimerSec(state.settings.roundTimerSec ?? '')
    setProfanity(!!state.settings.profanityFilterEnabled)
    if (state.phase === 'guessing' && state.currentRound && myId && state.currentRound.guesserId === myId) {
      // default ordering = participants by seat order
      const bySeat = [...state.players]
        .filter(p => state.currentRound!.participants.includes(p.id))
        .sort((a,b)=>a.seat-b.seat)
        .map(p=>p.id)
      setOrdering(prev => prev.length ? prev : bySeat)
    }
    if (state.phase !== 'answering' && endsAt != null) setEndsAt(null)
  }, [state, myId])

  // Smooth local timer tick
  useEffect(() => {
    if (!endsAt) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [endsAt])

  // Update progress bar width without inline JSX styles
  useEffect(() => {
    if (!progressRef.current) return
    if (!endsAt || !state) { progressRef.current.style.width = '0%'; return }
    const total = (state.settings.roundTimerSec ?? 90) * 1000
    const pct = Math.max(0, Math.min(100, ((endsAt - now) / total) * 100))
    progressRef.current.style.width = `${pct}%`
  }, [endsAt, now, state])

  function onDragStart(index: number) { setDragIndex(index) }
  function onDrop(index: number) {
    if (dragIndex == null || dragIndex === index) return
    setOrdering(prev => {
      const arr = prev.slice()
      const [moved] = arr.splice(dragIndex, 1)
      arr.splice(index, 0, moved)
      // broadcast preview if I am the guesser
      if (state?.phase === 'guessing' && state.currentRound && myId && state.currentRound.guesserId === myId) {
        socket.emit('ordering:preview', { ordering: arr })
      }
      return arr
    })
    setDragIndex(null)
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault() }

  return (
    <div className="container py-6 space-y-6">
      <header className="flex items-center justify-between">
  <h1 className="text-2xl font-semibold">Sequencing</h1>
        <span className={connected ? 'text-green-400' : 'text-red-400'}>{connected ? 'online' : 'offline'}</span>
      </header>

      <section className="card space-y-3">
        <div>
          <label className="block text-sm mb-1">Display name</label>
          <input className="input" value={displayName} maxLength={20} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" />
        </div>
        {!state ? (
          <div className="flex gap-2">
            <button className="button" onClick={createRoom} disabled={!connected}>Create room</button>
            <input className="input max-w-[120px]" value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="CODE" />
            <button className="button" onClick={joinRoom} disabled={!connected}>Join</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button className="button" onClick={leaveRoom}>Leave room</button>
            <button className="button" onClick={copyRoomLink}>Copy room link</button>
            {copyMsg && <span className="text-xs text-green-400">{copyMsg}</span>}
          </div>
        )}
        {error && <div className="text-red-400 text-sm">{error}</div>}
      </section>

      {state && (
        <section className="card space-y-2">
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <span>Room {state.code} · phase {state.phase}</span>
            {state.stats && (
              <span className="text-neutral-300">Wins {state.stats.wins} · Losses {state.stats.losses}</span>
            )}
          </div>
          {state.currentRound && (
            <div className="text-sm space-y-2">
                  <div>Prompt: <span className="text-neutral-200">{state.currentRound.prompt}</span></div>
            {state.phase === 'answering' && endsAt && (
                    <div className="h-2 w-full bg-neutral-800 rounded overflow-hidden">
              <div ref={progressRef} className="h-full bg-green-500 transition-[width] duration-100" />
                    </div>
                  )}
      {state.phase === 'answering' && (
                <div className="space-y-2">
                  {myNumber != null && (
                    <div className="text-center">
                      <div className="text-5xl font-extrabold text-neutral-100 leading-none">{myNumber}</div>
                      <div className="text-xs text-neutral-400 mt-1">Your number</div>
                    </div>
                  )}
                  <textarea className="input h-24" value={myAnswer} maxLength={200} onChange={e => setMyAnswer(e.target.value)} placeholder="Your answer" />
                  <div className="flex items-center gap-2">
                    <button className="button" onClick={submitAnswer} disabled={!myAnswer.trim()}>Submit answer</button>
            <span className="text-xs text-neutral-400">Answered: {answeredIds.length}/{state.currentRound.participants.length}</span>
            {endsAt && <span className="text-xs text-neutral-400">Time left: {Math.max(0, Math.ceil((endsAt - now)/1000))}s</span>}
                  </div>
                </div>
              )}
                  {state.phase === 'guessing' && state.currentRound && (
                myId && state.currentRound.guesserId === myId ? (
                  <div className="space-y-2">
                    <div className="text-xs text-neutral-400">Drag to order players from least → greatest, then submit.</div>
          <ul className={`grid ${gridColsClass(ordering.length || (state.currentRound?.participants.length ?? 1))} gap-2 w-full`}>
                      {ordering.map((pid, i) => {
                        const p = state.players.find(pp => pp.id === pid)
                        if (!p) return null
                        return (
              <li key={pid}
                className="w-full px-3 py-2 rounded bg-neutral-800 border border-neutral-700 cursor-move select-none"
                              draggable
                              onDragStart={() => onDragStart(i)}
                              onDragOver={onDragOver}
                              onDrop={() => onDrop(i)}
                          >
                                <div className="flex flex-col">
                                  <span>{p.name}</span>
                                  <span className="text-[11px] text-neutral-400 max-w-[240px] truncate">{state.currentRound?.answers?.[p.id] ?? ''}</span>
                                </div>
                          </li>
                        )
                      })}
                    </ul>
                    <div className="flex gap-2">
                      <button className="button" onClick={submitOrdering} disabled={ordering.length !== state.currentRound.participants.length}>Submit ordering</button>
                    </div>
                  </div>
                ) : (
                      <div className="space-y-2">
                        <div className="text-xs text-neutral-400">Waiting for the guesser to submit an ordering…</div>
                        {orderingPreview.length > 0 && (
          <ul className={`grid ${gridColsClass(orderingPreview.length || (state.currentRound?.participants.length ?? 1))} gap-2 w-full`}>
                            {orderingPreview.map(pid => {
                              const p = state.players.find(pp => pp.id === pid)
                              if (!p) return null
                              return (
            <li key={pid} className="w-full px-3 py-2 rounded bg-neutral-800 border border-neutral-700 select-none">
                                  <div className="flex flex-col">
                                    <span>{p.name}</span>
                                    <span className="text-[11px] text-neutral-400 max-w-[240px] truncate">{state.currentRound?.answers?.[p.id] ?? ''}</span>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                )
              )}
              {state.phase === 'reveal' && result && (
                <Reveal
                  players={state.players}
                  numbers={result.numbers}
                  submitted={result.submitted ?? []}
                  onDone={(win) => setRevealWin(win)}
                />
              )}
              {state.phase === 'reveal' && myId && state.hostId === myId && (
                <div className="pt-2">
                  <button className="button" onClick={() => socket.emit('round:next')}>Next round</button>
                </div>
              )}
            </div>
          )}
          <ul className="grid grid-cols-2 gap-2">
    {state.players.sort((a,b)=>a.seat-b.seat).map(p => (
              <li key={p.id} className="p-2 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
      <span className={`inline-block w-3 h-3 rounded-full ${colorClass(p.color)} ${p.connected ? '' : 'opacity-40'}`} />
                  <span>{p.name}</span>
                  <span className="text-xs text-neutral-500">(seat {p.seat}{!p.connected ? ', disconnected' : ''})</span>
                </div>
                {myId && state.hostId === myId && p.id !== myId && (
                  <button className="button ml-2" onClick={() => kick(p.id)}>Kick</button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-2 items-center">
            {myId && state.hostId === myId && state.phase === 'lobby' && (
              <>
                <input className="input" placeholder="Custom prompt (optional)" value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} />
                <button className="button" onClick={startRound}>Start round</button>
                <button className="button" onClick={shuffleSeats}>Shuffle seats</button>
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <label className="flex items-center gap-1">
                    Timer (sec)
                    <input type="number" min={10} max={300} className="input w-20" value={timerSec}
                      onChange={e => setTimerSec(e.target.value === '' ? '' : Math.max(10, Math.min(300, Number(e.target.value))))}
                      onBlur={() => { if (typeof timerSec === 'number') updateSettings({ roundTimerSec: timerSec }) }} />
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={profanity} onChange={(e) => { setProfanity(e.target.checked); updateSettings({ profanityFilterEnabled: e.target.checked }) }} />
                    Profanity filter
                  </label>
                </div>
              </>
            )}
            {/* End round button removed per requirement */}
          </div>
        </section>
      )}

  <footer className="text-xs text-neutral-500">Sequencing · MVP · self-hosted ARM + Apache</footer>
    </div>
  )
}

type RevealProps = {
  players: { id: string; name: string; seat: number; connected: boolean; color: string }[]
  numbers: Record<string, number>
  submitted: string[]
  onDone?: (win: boolean) => void
}

function Reveal({ players, numbers, submitted, onDone }: RevealProps) {
  const [flipped, setFlipped] = useState<number>(-1)
  const [win, setWin] = useState<boolean | null>(null)

  useEffect(() => {
    if (!submitted || submitted.length === 0) return
    setFlipped(-1)
    setWin(null)
    // animate flips, one every 700ms
    let i = -1
    const id = window.setInterval(() => {
      i += 1
      setFlipped(i)
      if (i >= submitted.length - 1) {
        window.clearInterval(id)
        // compute win: strictly non-decreasing by submitted order
        let ok = true
        for (let k = 1; k < submitted.length; k++) {
          if (numbers[submitted[k]] < numbers[submitted[k - 1]]) { ok = false; break }
        }
        setWin(ok)
        onDone?.(ok)
      }
    }, 700)
    return () => window.clearInterval(id)
  }, [submitted, numbers])

  return (
    <div className="space-y-3 text-sm">
      <div className="text-neutral-300">Reveal:</div>
      <ul className={`grid ${gridColsClass(submitted.length)} gap-2 w-full`}>
        {submitted.map((pid, idx) => {
          const p = players.find(pp => pp.id === pid)
          if (!p) return null
          const isFlipped = idx <= flipped
          // correctness: red border if this number < previous revealed number
          let border = 'border-neutral-700'
          if (isFlipped) {
            const prev = idx > 0 ? numbers[submitted[idx - 1]] : undefined
            const curr = numbers[pid]
            if (prev === undefined || curr >= prev) border = 'border-green-500'
            else border = 'border-red-500'
          }
          return (
            <li key={pid} className={`w-full px-3 py-2 rounded bg-neutral-800 border ${border} select-none transition-transform duration-300`}>
              <div className="flex items-center gap-2">
                <span className={`inline-block w-3 h-3 rounded-full ${colorClass(p.color)}`} />
                <div className="flex flex-col">
                  <span>{p.name}</span>
                  <span className="text-[11px] text-neutral-400">{isFlipped ? numbers[pid] : '…'}</span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {win != null && (
        <div className={`mt-1 text-sm ${win ? 'text-green-400' : 'text-red-400'}`}>
          {win ? 'Win! Full correct ordering.' : 'Not quite. Sequence had mistakes.'}
        </div>
      )}
    </div>
  )
}

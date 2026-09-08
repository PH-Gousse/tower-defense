/**
 * Two real clients over real WebSockets, through the real Durable Object.
 *
 *   cd packages/server && npx wrangler dev --port 8787 --local
 *   pnpm --filter @ltw/harness live
 *
 * This is not part of `pnpm test`: it needs a Worker running, and CI has none.
 * It exists because the room tests exercise every decision the relay makes but
 * none of the adapter around it -- WebSocketPair, the hibernation seat tags,
 * JSON framing, socket close. Those are exactly where Cloudflare-specific
 * mistakes live, and one of them took the whole Worker down before a single
 * request arrived: Workers rejects any named export from the entry point that
 * is not a Durable Object class or a handler, so a plain helper function there
 * is a module-load failure.
 *
 * The client here deliberately runs the simulation as fast as it can rather
 * than at 20Hz, which is why a couple of frames still fall outside the relay's
 * acceptance window. A real client is clocked and does not drift.
 */
// Two real clients over real WebSockets through the Durable Object.
// Proves the adapter layer the Room tests cannot reach: WebSocketPair,
// hibernation tagging, seat routing, and JSON framing.
const base = 'http://localhost:8787'
const { code } = await (await fetch(`${base}/new`)).json()
console.log('room', code)

const sim = await import('@ltw/sim')
const { localVersions, createState, step, hashState, InputBuffer, watermarkCadence,
        botCommand, BOT_NORMAL, BOT_HARD } = sim

function client(seat, bot) {
  return {
    seat, bot, ws: null, a: createState(), b: createState(), buffer: null,
    delay: 0, tick: 0, lastWm: -1, hashes: new Map(), started: false, seatAssigned: null,
  }
}

const cs = [client(0, BOT_NORMAL), client(1, BOT_HARD)]

function open(c) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:8787/r/${code}`)
    c.ws = ws
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', versions: localVersions() })))
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.t === 'welcome') { c.seatAssigned = m.seat; resolve() }
      else if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: m.id }))
      else if (m.t === 'start') { c.delay = m.delay; c.buffer = new InputBuffer(m.delay); c.started = true }
      else if (m.t === 'cmd') c.buffer?.add(m.cmd)
      else if (m.t === 'wm') c.buffer?.mark(m.player, m.tick)
      else if (m.t === 'refused') console.log(`seat ${c.seatAssigned} refused:`, m.reason, m.detail ?? '')
      else if (m.t === 'dropped') console.log(`seat ${c.seatAssigned} dropped:`, m.reason)
      else if (m.t === 'ended') console.log('ended:', m.reason, 'winner', m.winner)
    })
  })
}

await open(cs[0])
await open(cs[1])
console.log('seats', cs.map(c => c.seatAssigned).join(', '))

const t0 = Date.now()
while (!cs.every(c => c.started)) {
  if (Date.now() - t0 > 8000) throw new Error('never started')
  await new Promise(r => setTimeout(r, 20))
}
console.log('started, delay =', cs[0].delay, cs[1].delay)

const MAX = 900
let diverged = -1
for (let guard = 0; guard < MAX * 6; guard++) {
  for (const c of cs) {
    const at = c.tick + c.delay
    const cmd = botCommand(c.a, c.seatAssigned, c.bot)
    if (cmd) c.ws.send(JSON.stringify({ t: 'cmd', cmd: { ...cmd, tick: at } }))
    if (at - c.lastWm >= watermarkCadence(c.delay)) {
      c.ws.send(JSON.stringify({ t: 'wm', tick: at }))
      c.lastWm = at
    }
  }
  // Let real socket messages land.
  await new Promise(r => setTimeout(r, 1))
  for (const c of cs) {
    while (c.buffer.ready(c.tick) && c.tick < MAX) {
      const out = step(c.a, c.buffer.take(c.tick), c.b)
      c.b = c.a; c.a = out; c.tick = c.a.tick
      c.hashes.set(c.tick, hashState(c.a) >>> 0)
    }
  }
  for (const [t, h] of cs[0].hashes) {
    const o = cs[1].hashes.get(t)
    if (o !== undefined && o !== h) { diverged = t; break }
  }
  if (diverged !== -1) break
  if (cs.every(c => c.tick >= MAX)) break
}

console.log('ticks', cs.map(c => c.tick).join(' / '))
console.log('diverged at', diverged)
console.log('final hashes', hashState(cs[0].a) >>> 0, hashState(cs[1].a) >>> 0)

// Concede must end it out of band, instantly.
cs[0].ws.send(JSON.stringify({ t: 'concede' }))
await new Promise(r => setTimeout(r, 300))
cs.forEach(c => c.ws.close())
console.log(diverged === -1 && cs[0].tick >= MAX ? 'PASS' : 'FAIL')

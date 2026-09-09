import { createScene, WebGLUnavailable, type Selection, type Scene } from './scene'
import { Net, relayUrl } from './net'
import { holdToRepeat } from './hold'
import { createSender } from './send'
import { STALL_TICKS } from '@ltw/sim'
import {
  TowerKind, ARCHETYPES, levelOf, MAX_LEVEL, TICK_HZ, MatchResult,
  CREEPS, tierUnlockTick, SEND_UNLOCK_TICKS, INCOME_EVERY_TICKS, MAX_TIER,
  BOT_EASY, BOT_NORMAL, BOT_HARD, type BotConfig,
} from '@ltw/sim'

let scene: Scene
try {
  scene = createScene(document.body)
} catch (err) {
  // Say why, and stop. Continuing would leave a page that looks like the game
  // but responds to nothing.
  const msg = document.createElement('div')
  msg.id = 'fatal'
  msg.innerHTML =
    '<div><h2>WebGL is unavailable</h2>' +
    '<p>This game renders with WebGL. Enable hardware acceleration, or try a different browser.</p></div>'
  document.body.appendChild(msg)
  if (!(err instanceof WebGLUnavailable)) throw err
  throw err
}

const el = (id: string) => document.getElementById(id)
const lives = el('lives')
const oppLives = el('oppLives')
const income = el('income')
const leaks = el('leaks')
const gold = el('gold')
const over = el('over')
const overDetail = el('overDetail')
const towers = el('towers')
const creeps = el('creeps')
const kills = el('kills')
const maze = el('maze')
const tile = el('tile')
const note = el('note')

const panel = el('panel')
const panelTitle = el('panelTitle')
const panelDamage = el('panelDamage')
const panelRange = el('panelRange')
const panelRate = el('panelRate')
const btnUpgrade = el('btnUpgrade') as HTMLButtonElement | null
const btnSell = el('btnSell') as HTMLButtonElement | null

const tools = Array.from(document.querySelectorAll<HTMLButtonElement>('.tool'))
const sendRow = el('sendRow')
const sendLabel = el('sendLabel')

// --- send palette ----------------------------------------------------------
// Build and Send stay separate palettes on purpose: they are opposite-facing
// economies, and merging them makes a 140g send one misclick from a 110g tower.
//
// The palette is a WINDOW on the roster, not the whole roster. Step 8 replaced
// the fixed six-creep list with a growth rule that keeps producing tiers for as
// long as a match runs -- sixty-three of them -- because a ladder that stops
// leaves a maze nothing can break and the match never ends. Sixty-three buttons
// is not a palette, so this shows the tier you can buy now and the one arriving
// next, and re-points the same six buttons as the ladder advances.
const ARCHETYPE_COUNT = 3
const WINDOW_TIERS = 2
const SEND_KEYS = ['q', 'w', 'e', 'r', 't', 'y']

const creepButtons: HTMLButtonElement[] = []
const holdStops: Array<() => void> = []

// Every way to send goes through here: click, key, hold, and the ×N buttons
// when they land. See `send.ts` for why that is one function and not five.
const sendN = createSender(creepButtons, (creep) => scene.send(creep))

if (sendRow) {
  for (let slot = 0; slot < ARCHETYPE_COUNT * WINDOW_TIERS; slot++) {
    const b = document.createElement('button')
    b.className = 'creep'
    b.dataset.creep = String(slot)
    b.innerHTML = '<span class="n"></span><span class="c"></span>'
    holdStops.push(holdToRepeat(b, () => sendN(slot, 1) > 0, window))
    sendRow.appendChild(b)
    creepButtons.push(b)
  }
  // A press held while the tab goes away would otherwise repeat into nothing
  // and still be repeating on return.
  window.addEventListener('blur', () => {
    for (const stop of holdStops) stop()
  })
}

/** Highest tier buyable at this tick. */
function unlockedTier(tick: number): number {
  let tier = 0
  while (tier + 1 <= MAX_TIER && tick >= tierUnlockTick(tier + 1)) tier += 1
  return tier
}

// One key per palette slot, along the top row in palette order. Hard-coding
// three of them silently stranded half the palette on the mouse the moment the
// roster grew.
window.addEventListener('keydown', (ev) => {
  // Auto-repeat is the operating system holding the key down for you, about
  // thirty times a second, on its own schedule. That is not the hold cadence --
  // it is faster than a tick, so the wallet check it never had would have been
  // stale anyway -- and one press of `q` could empty a wallet before the finger
  // came off. A held key sends once. Holding the BUTTON is the deliberate
  // repeat, at HOLD_EVERY_MS, and it stops when a send is refused.
  if (ev.repeat) return
  const slot = SEND_KEYS.indexOf(ev.key.toLowerCase())
  if (slot === -1) return
  sendN(slot, 1)
})

// --- build palette ---------------------------------------------------------

for (const kind of [TowerKind.Single, TowerKind.Splash, TowerKind.Slow]) {
  const costEl = el(`cost${kind}`)
  if (costEl) costEl.textContent = String(levelOf(kind, 1).cost)
}

function selectTool(kind: TowerKind): void {
  scene.setTool(kind)
  for (const t of tools) {
    t.classList.toggle('selected', Number(t.dataset.tower) === kind)
  }
}

for (const t of tools) {
  t.addEventListener('click', () => selectTool(Number(t.dataset.tower) as TowerKind))
}

window.addEventListener('keydown', (ev) => {
  if (ev.key === '1') selectTool(TowerKind.Single)
  if (ev.key === '2') selectTool(TowerKind.Splash)
  if (ev.key === '3') selectTool(TowerKind.Slow)
})

// --- selection panel -------------------------------------------------------

btnUpgrade?.addEventListener('click', () => scene.upgradeSelected())
btnSell?.addEventListener('click', () => scene.sellSelected())

scene.onSelect((sel: Selection | null) => {
  if (!panel) return
  if (!sel) {
    panel.hidden = true
    return
  }
  panel.hidden = false
  const arch = ARCHETYPES[sel.tower]
  const spec = levelOf(sel.tower, sel.level)
  if (panelTitle) panelTitle.textContent = `${arch?.name ?? '?'} · Lv ${sel.level}`
  if (panelDamage) panelDamage.textContent = String(spec.damage)
  if (panelRange) panelRange.textContent = spec.range.toFixed(1)
  // Cooldown is in ticks; shots per second is what a player can reason about.
  if (panelRate) panelRate.textContent = `${(TICK_HZ / spec.cooldownTicks).toFixed(1)}/s`

  if (btnUpgrade) {
    btnUpgrade.disabled = !sel.canUpgrade
    btnUpgrade.textContent =
      sel.level >= MAX_LEVEL ? 'Max level' : `Upgrade · ${sel.upgradeCost}g`
  }
  if (btnSell) btnSell.textContent = `Sell · +${sel.sellValue}g`
})

// --- stats -----------------------------------------------------------------

scene.onStats((s) => {
  if (gold) gold.textContent = String(s.gold)
  if (income) income.textContent = `${s.income} /15s`
  if (oppLives) oppLives.textContent = String(s.oppLives)

  // Slide the window as tiers unlock, then paint each card. Cards carry three
  // states, not two: affordable, unaffordable, and not-yet-unlocked. Locked is
  // first-class because tiers open on a timer and knowing what is coming
  // changes what you save for.
  // The palette label carries the countdown, because six cards all reading
  // "build phase, 12s" states the rule six times and explains it none. One
  // clock, where the eye already goes to decide what to send.
  if (sendLabel) {
    const left = SEND_UNLOCK_TICKS - s.tick
    sendLabel.textContent = left > 0 ? `Build · ${Math.ceil(left / TICK_HZ)}s` : 'Send →'
    sendLabel.classList.toggle('counting', left > 0)
  }

  const tier = unlockedTier(s.tick)
  for (let slot = 0; slot < creepButtons.length; slot++) {
    const b = creepButtons[slot]!
    const slotTier = tier + Math.floor(slot / ARCHETYPE_COUNT)
    const index = slotTier * ARCHETYPE_COUNT + (slot % ARCHETYPE_COUNT)
    const spec = CREEPS[index]
    if (!spec) {
      b.hidden = true
      continue
    }
    b.hidden = false
    b.dataset.creep = String(index)
    const name = b.querySelector('.n')
    if (name) name.textContent = spec.name
    const c = b.querySelector('.c')
    // Two reasons a card can be locked, and only one of them belongs on the
    // card. A tier lock is about THIS card, so it says so. The build phase is
    // about all six at once and already has the countdown in the label beside
    // them; repeating it here said the same thing six times, and said it in
    // enough characters to wrap every card to two lines and grow the whole
    // palette -- which then pushed the camera's safe area and re-framed the
    // board. During the opening the cards keep their normal description, dimmed:
    // what you will be able to send is worth reading while you wait for it.
    const opening = s.tick < SEND_UNLOCK_TICKS
    const tierLocked = s.tick < tierUnlockTick(spec.tier)
    if (opening || tierLocked) b.setAttribute('data-locked', 'true')
    else b.removeAttribute('data-locked')

    // The ×N reads as nothing today and that is correct, not leftover: every
    // archetype ships count 1, because one purchase is one creep. The roster
    // still carries the field and the sim still honours it, so a pack card can
    // come back without touching this line -- which is why it stays a condition
    // rather than being deleted along with the six-swarm pack.
    if (c) {
      c.textContent =
        tierLocked && !opening
          ? `${spec.cost}g · unlocks in ${Math.ceil((tierUnlockTick(spec.tier) - s.tick) / TICK_HZ)}s`
          : `${spec.cost}g` +
            (spec.count > 1 ? ` ×${spec.count}` : '') +
            ` · +${spec.incomeBonus} inc`
    }
    if (!opening && !tierLocked && s.gold < spec.cost) b.setAttribute('data-broke', 'true')
    else b.removeAttribute('data-broke')
  }
  if (leaks) leaks.textContent = String(s.leaks)
  if (lives) {
    lives.textContent = String(s.lives)
    // Turn red under real pressure. A leak is a drain, not a one-off penalty,
    // so the number falling is the thing to watch.
    if (s.lives <= 5) lives.setAttribute('data-low', 'true')
    else lives.removeAttribute('data-low')
  }
  if (stalled) {
    // Under strict wait a slow peer stops both simulations. Say so, or the
    // player whose connection is fine thinks the game broke.
    stalled.hidden = s.peerLag < STALL_TICKS
  }
  if (over && !endedByRelay) {
    over.hidden = s.result === MatchResult.Playing
    if (overDetail && s.result !== MatchResult.Playing) {
      const won = s.winner === 0
      const title = document.querySelector('#over h2')
      if (title) title.textContent = s.result === MatchResult.Draw ? 'Draw' : won ? 'You win' : 'Out of lives'
      overDetail.textContent =
        `${s.leaks} leaks against you, ${s.kills} kills. Reload to try again — rematch arrives with the server at step 10.`
    }
  }
  if (desyncPanel) {
    desyncPanel.hidden = s.desync === null
    if (s.desync && desyncTick) desyncTick.textContent = `tick ${s.desync.tick}`
  }
  if (towers) towers.textContent = String(s.towers)
  if (creeps) creeps.textContent = String(s.creeps)
  if (kills) kills.textContent = String(s.kills)
  if (maze) maze.textContent = s.maze < 0 ? 'sealed' : String(s.maze)
  // Dim what you cannot afford rather than hiding it, so you can plan toward it.
  for (const t of tools) {
    const kind = Number(t.dataset.tower) as TowerKind
    if (s.gold < levelOf(kind, 1).cost) t.setAttribute('data-broke', 'true')
    else t.removeAttribute('data-broke')
  }
})

// --- hover -----------------------------------------------------------------

// --- desync and the match file ---------------------------------------------

const desyncPanel = el('desync')
const desyncTick = el('desyncTick')

/**
 * Hand the player a file.
 *
 * A blob URL and a synthetic click, because there is no server to post to and
 * deliberately never will be: the dump is the only observability in the project
 * precisely so that debugging needs no backend, no telemetry and no logging.
 */
function saveDump(trigger: 'desync' | 'manual'): void {
  const dump = scene.dump(trigger)
  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ltw-${trigger}-${dump.build}-t${dump.ticks}.json`
  a.click()
  // Revoking immediately can cancel the download in some browsers; a tick of
  // slack is enough and the blob is small.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast(`Saved ${a.download} — ${dump.commands.length} commands, ${dump.ticks} ticks`)
}

let toastTimer = 0
function toast(text: string): void {
  let box = el('toast')
  if (!box) {
    box = document.createElement('div')
    box.id = 'toast'
    document.body.appendChild(box)
  }
  box.textContent = text
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => box?.remove(), 4000)
}

el('desyncSave')?.addEventListener('click', () => saveDump('desync'))

window.addEventListener('keydown', (ev) => {
  // A match that merely *felt* wrong is worth capturing too, not just one that
  // tripped the hash check. Guarded so it cannot fire while typing in a field.
  if (ev.key.toLowerCase() !== 'd') return
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return
  saveDump('manual')
})

// A prediction that failed is worth a word: the tower the player thought they
// placed is not there, and silence reads as the game ignoring them.
scene.onGhostFailed((text) => toast(text))

scene.onTileHover((h) => {
  if (tile) tile.textContent = h.tile ? `${h.tile.x}, ${h.tile.y}` : '—'
  if (!note) return
  if (!h.tile) {
    note.textContent = 'hover a tile'
    note.removeAttribute('data-refused')
    return
  }
  if (h.refusalText) {
    // The no-block rule is invisible until you hit it. Saying why beats a
    // silent no-op, which teaches nothing.
    note.textContent = h.refusalText
    note.setAttribute('data-refused', 'true')
    return
  }
  note.removeAttribute('data-refused')
  note.textContent =
    h.mazeDelta === null ? 'click to build' : `+${h.mazeDelta} tiles · click to build`
})

// --- playing a friend --------------------------------------------------------
//
// The bot path and the network path share everything except who supplies the
// opponent's inputs. That is deliberate: a bot match is a genuine rehearsal for
// a networked one rather than a second program, so the fixed timestep, the
// hashing and the command log are all exercised long before a socket exists.

const btnHost = el('btnHost') as HTMLButtonElement | null
const btnJoin = el('btnJoin') as HTMLButtonElement | null
const joinCode = el('joinCode') as HTMLInputElement | null
const roomCode = el('roomCode')
const netNote = el('netNote')
const stalled = el('stalled')
const btnConcede = el('concede') as HTMLButtonElement | null
const btnRematch = el('btnRematch') as HTMLButtonElement | null

let net: Net | null = null
let mySeat: 0 | 1 = 0
let endedByRelay: { reason: 'concede' | 'left'; winner: 0 | 1 } | null = null

function netSay(text: string): void {
  if (netNote) netNote.textContent = text
}

function connect(code: string): void {
  netSay('connecting…')
  net = new Net(relayUrl(code), {
    onWelcome: (seat, roomCodeGiven) => {
      mySeat = seat
      // Adopt the seat before a single tick runs. Without this the second
      // player to join sends every command stamped for player 0 and the relay
      // refuses all of them.
      scene.driver.setSeat(seat)
      if (roomCode) roomCode.textContent = roomCodeGiven
      // A link is easier to send than six letters read down a phone.
      const url = new URL(window.location.href)
      url.searchParams.set('room', roomCodeGiven)
      window.history.replaceState(null, '', url)
      netSay(seat === 0 ? 'Room open. Send the code or this page’s link.' : 'Joined. Starting…')
    },
    onLobby: (seated) => {
      if (seated < 2) netSay('Waiting for your opponent to join…')
    },
    onStart: (delay) => {
      // From here the inputs decide when the simulation advances, not the clock.
      scene.driver.goLockstep(
        delay,
        (cmd) => net?.sendCommand(cmd),
        (tick) => net?.sendWatermark(tick),
      )
      if (startScreen) startScreen.hidden = true
      if (btnConcede) btnConcede.hidden = false
      scene.start()
    },
    onCommand: (cmd) => scene.driver.receive(cmd),
    onWatermark: (player, tick) => scene.driver.receiveWatermark(player, tick),
    onEnded: (reason, winner) => {
      endedByRelay = { reason, winner }
      if (btnConcede) btnConcede.hidden = true
      if (btnRematch) btnRematch.hidden = false
      showEnding()
    },
    onRefused: (reason, detail) => {
      netSay(
        reason === 'version'
          ? 'This tab is running an old build. Reload the page — the game updated.'
          : reason === 'room-full'
            ? 'That room already has two players.'
            : reason === 'already-started'
              ? 'That match has already started.'
              : `Refused: ${reason}${detail ? ` (${detail})` : ''}`,
      )
      net?.close()
      net = null
    },
    onDropped: (reason, tick) => {
      if (tick !== undefined) scene.driver.refuseGhost(tick, reason)
      toast(`One input was dropped by the relay: ${reason}`)
    },
    onPeer: (present) => netSay(present ? 'Opponent connected.' : 'Opponent left.'),
    onRematch: (seated) => netSay(seated < 2 ? 'Waiting for them to accept…' : 'Rematch starting…'),
    onClosed: () => {
      netSay('Connection lost. There is no reconnect yet — reload to start again.')
      if (btnConcede) btnConcede.hidden = true
    },
  })
  net.connect()
}

async function hostRoom(): Promise<void> {
  netSay('creating a room…')
  try {
    const base = (import.meta.env.VITE_RELAY ?? 'https://ltw-relay.workers.dev')
      .replace(/^ws/, 'http')
      .replace(/\/$/, '')
    const res = await fetch(`${base}/new`)
    const { code } = (await res.json()) as { code: string }
    connect(code)
  } catch {
    netSay('Could not reach the relay. It may not be deployed yet.')
  }
}

btnHost?.addEventListener('click', () => void hostRoom())
btnJoin?.addEventListener('click', () => {
  const code = (joinCode?.value ?? '').trim().toUpperCase()
  if (code.length !== 6) {
    netSay('A room code is six letters and digits.')
    return
  }
  connect(code)
})

btnConcede?.addEventListener('click', () => {
  // Out of band. A concede stamped for T+delay could not be applied while the
  // sim is stalled waiting for the peer, which is exactly when it is wanted.
  net?.concede()
})

btnRematch?.addEventListener('click', () => {
  net?.rematch()
  if (btnRematch) btnRematch.hidden = true
})

// Join by URL: ?room=ABCDEF skips the lobby entirely.
const roomFromUrl = new URLSearchParams(window.location.search).get('room')
if (roomFromUrl && roomFromUrl.length === 6) {
  if (joinCode) joinCode.value = roomFromUrl.toUpperCase()
  connect(roomFromUrl.toUpperCase())
}

function showEnding(): void {
  if (!over || !endedByRelay) return
  over.hidden = false
  const title = document.querySelector('#over h2')
  const won = endedByRelay.winner === mySeat
  if (title) title.textContent = won ? 'You win' : 'You lose'
  if (overDetail) {
    overDetail.textContent =
      endedByRelay.reason === 'concede'
        ? won
          ? 'Your opponent conceded.'
          : 'You conceded.'
        : won
          ? 'Your opponent left the match.'
          : 'You left the match.'
  }
}

// --- start ------------------------------------------------------------------
// The scene is built above so a missing WebGL context fails before the player
// invests anything; the clock only starts once they have picked an opponent.

const BOTS: Record<string, BotConfig> = { easy: BOT_EASY, normal: BOT_NORMAL, hard: BOT_HARD }
const startScreen = el('start')

// `[data-bot]`, not every button on the start screen. Step 11 added "Create a
// room" and "Join" inside the same panel, and a selector of `#start button`
// silently bound the bot-match handler to those too -- so creating a room
// started a single-player game against Normal at the same moment, behind the
// lobby. It looked like the room had opened and the match had begun.
for (const b of Array.from(
  document.querySelectorAll<HTMLButtonElement>('#start button[data-bot]'),
)) {
  b.addEventListener('click', () => {
    scene.setBot(BOTS[b.dataset.bot ?? 'normal'] ?? BOT_NORMAL)
    if (startScreen) startScreen.hidden = true
    scene.start()
    // `start()` frames the board, but the palette is still its pre-match height
    // at this instant -- the send buttons are built by the first stats callback,
    // one tick later. Re-measure once the layout has settled, or the board is
    // framed against a shorter palette than the one that ends up covering it and
    // the exit row hides behind the bar. Waiting on the ResizeObserver alone is
    // not enough: if the palette's height happens not to change, it never fires.
    requestAnimationFrame(() => requestAnimationFrame(syncSafeArea))
  })
}

/**
 * Keep the camera framing clear of the fixed HUD and palette.
 *
 * The canvas fills the window and both bars sit on top of it, so without this
 * the board is framed edge to edge and the entrance and exit rows -- the two
 * the player most needs to see -- hide behind the chrome. Measured rather than
 * hardcoded because the palette's height is not fixed: it grows a row of send
 * buttons once a match starts, and grows again as heavier tiers unlock.
 *
 * A ResizeObserver rather than a `resize` listener, because the bars change
 * height without the window changing size.
 */
function syncSafeArea(): void {
  const top = document.getElementById('hud')?.getBoundingClientRect().height ?? 0
  const bottom = document.getElementById('palette')?.getBoundingClientRect().height ?? 0
  scene.setSafeArea(top, 0, bottom, 0)
}

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(syncSafeArea)
  for (const id of ['hud', 'palette']) {
    const el = document.getElementById(id)
    if (el) ro.observe(el)
  }
}
window.addEventListener('resize', syncSafeArea)
syncSafeArea()

// No picker in the DOM (a stripped test page) means nothing would ever start.
if (!startScreen) scene.start()

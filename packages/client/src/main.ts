import { createScene, WebGLUnavailable, type Selection, type Scene } from './scene'
import {
  TowerKind, ARCHETYPES, levelOf, MAX_LEVEL, TICK_HZ, MatchResult,
  CREEPS, tierUnlockTick, INCOME_EVERY_TICKS, MAX_TIER,
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
if (sendRow) {
  for (let slot = 0; slot < ARCHETYPE_COUNT * WINDOW_TIERS; slot++) {
    const b = document.createElement('button')
    b.className = 'creep'
    b.dataset.creep = String(slot)
    b.innerHTML = '<span class="n"></span><span class="c"></span>'
    b.addEventListener('click', () => {
      const i = Number(b.dataset.creep)
      if (b.hasAttribute('data-locked')) return
      scene.send(i)
    })
    sendRow.appendChild(b)
    creepButtons.push(b)
  }
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
  const slot = SEND_KEYS.indexOf(ev.key.toLowerCase())
  if (slot === -1) return
  const b = creepButtons[slot]
  if (!b || b.hasAttribute('data-locked')) return
  scene.send(Number(b.dataset.creep))
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
    const locked = s.tick < tierUnlockTick(spec.tier)
    if (locked) {
      b.setAttribute('data-locked', 'true')
      const secs = Math.ceil((tierUnlockTick(spec.tier) - s.tick) / TICK_HZ)
      if (c) c.textContent = `${spec.cost}g · unlocks in ${secs}s`
    } else {
      b.removeAttribute('data-locked')
      if (c) {
        c.textContent =
          `${spec.cost}g` + (spec.count > 1 ? ` ×${spec.count}` : '') + ` · +${spec.incomeBonus} inc`
      }
      if (s.gold < spec.cost) b.setAttribute('data-broke', 'true')
      else b.removeAttribute('data-broke')
    }
  }
  if (leaks) leaks.textContent = String(s.leaks)
  if (lives) {
    lives.textContent = String(s.lives)
    // Turn red under real pressure. A leak is a drain, not a one-off penalty,
    // so the number falling is the thing to watch.
    if (s.lives <= 5) lives.setAttribute('data-low', 'true')
    else lives.removeAttribute('data-low')
  }
  if (over) {
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

// --- start ------------------------------------------------------------------
// The scene is built above so a missing WebGL context fails before the player
// invests anything; the clock only starts once they have picked an opponent.

const BOTS: Record<string, BotConfig> = { easy: BOT_EASY, normal: BOT_NORMAL, hard: BOT_HARD }
const startScreen = el('start')

for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#start button'))) {
  b.addEventListener('click', () => {
    scene.setBot(BOTS[b.dataset.bot ?? 'normal'] ?? BOT_NORMAL)
    if (startScreen) startScreen.hidden = true
    scene.start()
  })
}

// No picker in the DOM (a stripped test page) means nothing would ever start.
if (!startScreen) scene.start()

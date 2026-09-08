import { createScene, WebGLUnavailable, type Selection, type Scene } from './scene'
import {
  TowerKind, ARCHETYPES, levelOf, MAX_LEVEL, TICK_HZ, MatchResult,
  CREEPS, tierUnlockTick, INCOME_EVERY_TICKS,
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
const creepButtons: HTMLButtonElement[] = []
if (sendRow) {
  CREEPS.forEach((spec, i) => {
    const b = document.createElement('button')
    b.className = 'creep'
    b.dataset.creep = String(i)
    b.innerHTML =
      `<span class="n">${spec.name}</span>` +
      `<span class="c">${spec.cost}g` +
      (spec.count > 1 ? ` &times;${spec.count}` : '') +
      ` &middot; +${spec.incomeBonus} inc</span>`
    b.addEventListener('click', () => scene.send(i))
    sendRow.appendChild(b)
    creepButtons.push(b)
  })
}

window.addEventListener('keydown', (ev) => {
  const k = ev.key.toLowerCase()
  if (k === 'q') scene.send(0)
  if (k === 'w') scene.send(1)
  if (k === 'e') scene.send(2)
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

  // Creep cards carry three states, not two: affordable, unaffordable, and
  // not-yet-unlocked. Locked is first-class because tiers open on a timer and
  // knowing what is coming changes what you save for.
  for (const b of creepButtons) {
    const i = Number(b.dataset.creep)
    const spec = CREEPS[i]!
    const locked = s.tick < tierUnlockTick(spec.tier)
    if (locked) {
      b.setAttribute('data-locked', 'true')
      const secs = Math.ceil((tierUnlockTick(spec.tier) - s.tick) / TICK_HZ)
      const c = b.querySelector('.c')
      if (c) c.textContent = `unlocks in ${secs}s`
    } else {
      b.removeAttribute('data-locked')
      const c = b.querySelector('.c')
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

scene.start()

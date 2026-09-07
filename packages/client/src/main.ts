import { createScene, type Selection } from './scene'
import { TowerKind, ARCHETYPES, levelOf, MAX_LEVEL, TICK_HZ } from '@ltw/sim'

const scene = createScene(document.body)

const el = (id: string) => document.getElementById(id)
const gold = el('gold')
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

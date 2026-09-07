import { createScene } from './scene'

const scene = createScene(document.body)

const el = (id: string) => document.getElementById(id)
const towers = el('towers')
const creeps = el('creeps')
const maze = el('maze')
const tile = el('tile')
const note = el('note')

scene.onStats((s) => {
  if (towers) towers.textContent = String(s.towers)
  if (creeps) creeps.textContent = String(s.creeps)
  if (maze) maze.textContent = s.maze < 0 ? 'sealed' : String(s.maze)
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
  note.textContent = h.mazeDelta === null ? 'click to build' : `+${h.mazeDelta} tiles · click to build`
})
scene.start()

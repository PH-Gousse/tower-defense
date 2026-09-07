import { createScene } from './scene'

const scene = createScene(document.body)

const el = (id: string) => document.getElementById(id)
const towers = el('towers')
const creeps = el('creeps')
const maze = el('maze')
const tile = el('tile')

scene.onStats((s) => {
  if (towers) towers.textContent = String(s.towers)
  if (creeps) creeps.textContent = String(s.creeps)
  if (maze) maze.textContent = s.maze < 0 ? 'sealed' : String(s.maze)
})

scene.onTileHover((t, delta) => {
  if (!tile) return
  if (!t) { tile.textContent = '—'; return }
  tile.textContent = delta === null ? `${t.x}, ${t.y}` : `${t.x}, ${t.y}  +${delta}`
})

scene.start()

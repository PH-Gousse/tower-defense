import { createScene } from './scene'

const scene = createScene(document.body)

const tileEl = document.getElementById('tile')
const countEl = document.getElementById('count')

scene.onTileHover((t) => {
  if (tileEl) tileEl.textContent = t ? `${t.x}, ${t.y}` : '—'
})
scene.onTowerCount((n) => {
  if (countEl) countEl.textContent = String(n)
})

scene.start()

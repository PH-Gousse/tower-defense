import { measureLapDamage } from './lap-damage'

/**
 * `pnpm --filter @ltw/harness lap`
 *
 * The tuning table. Each cell is the HP a creep needs to survive one lap of
 * that maze — so a creep tier is threatening exactly when its HP exceeds the
 * cell for the maze a defender can afford at that point in the match.
 */
const DEFENCES: readonly (readonly [number, number])[] = [
  [6, 1], [12, 1], [20, 1], [30, 1], [30, 2], [30, 3], [50, 3], [80, 3], [120, 3],
]
const SPEEDS = [0.055, 0.075, 0.145]

console.log('\nHP needed to survive one lap\n')
console.log('defence      cost   maze  ' + SPEEDS.map((s) => `spd ${s}`.padStart(12)).join(''))
const COST = [60, 150, 290] // cumulative gold for a single-target tower at level 1/2/3
for (const [towers, level] of DEFENCES) {
  let line = `${towers}x L${level}`.padEnd(10)
  let cells = ''
  let maze = 0
  for (const speed of SPEEDS) {
    const r = measureLapDamage(towers, level, speed)
    maze = r.mazeLength
    cells += String(r.damage).padStart(12)
  }
  line += String(towers * (COST[level - 1] as number)).padStart(7)
  line += String(maze).padStart(7) + '  ' + cells
  console.log(line)
}
console.log()

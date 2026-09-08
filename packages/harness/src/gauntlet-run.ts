import { gauntletTable } from './gauntlet'

/**
 * `pnpm --filter @ltw/harness gauntlet`
 *
 * Reads as: at what size of maze does each creep stop getting through? A creep
 * whose row never says LEAK is a creep that can never threaten anyone, and a
 * creep whose row always says LEAK is one that ends the match on its own.
 */
const DEFENCES: readonly (readonly [number, number])[] = [
  [6, 1], [12, 1], [20, 1], [30, 1], [30, 2], [30, 3], [50, 3], [80, 3],
]

console.log('\ncreep            tier  maze   ' + DEFENCES.map(([t, l]) => `${t}x L${l}`.padStart(8)).join(''))
const rows = gauntletTable(DEFENCES)
let i = 0
for (let r = 0; r < rows.length; r += DEFENCES.length) {
  const first = rows[r]!
  let line = first.creep.padEnd(16) + String(first.tier).padStart(4) + String(first.mazeLength).padStart(6) + '   '
  for (let d = 0; d < DEFENCES.length; d++) {
    const row = rows[r + d]!
    line += (row.leaked > 0 ? `LEAK ${row.leaked}/${row.sent}` : `${(row.hpFraction * 100).toFixed(0)}%`).padStart(8)
  }
  console.log(line)
  i += 1
}
console.log('\n"LEAK n/m" = n of the m creeps in one purchase completed a lap.')
console.log('a percentage = all died; that is the share of HP the maze took at its worst.\n')

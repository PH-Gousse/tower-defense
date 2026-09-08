import { CREEPS, MAX_TIER, tierUnlockTick } from '@ltw/sim'

/** `pnpm --filter @ltw/harness roster` — what the growth rule actually produces. */
console.log(`\n${CREEPS.length} creeps, tiers 0..${MAX_TIER}\n`)
console.log('name           tier  unlock    cost  cnt        hp     waveHP    HP/g   inc  inc/g   bounty%')
for (const c of CREEPS) {
  if (c.tier > 10) continue
  const wave = c.hp * c.count
  console.log(
    `${c.name.padEnd(14)}${String(c.tier).padStart(4)}${String(tierUnlockTick(c.tier)).padStart(8)}` +
    `${String(c.cost).padStart(8)}${String(c.count).padStart(5)}${String(c.hp).padStart(10)}` +
    `${String(wave).padStart(11)}${(wave / c.cost).toFixed(2).padStart(8)}` +
    `${String(c.incomeBonus).padStart(6)}${(c.incomeBonus / c.cost).toFixed(4).padStart(8)}` +
    `${((c.bounty * c.count) / c.cost * 100).toFixed(0).padStart(9)}%`,
  )
}
console.log()

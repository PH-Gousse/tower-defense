import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { propose } from '../lib/proposal'
import type { AssetSpec } from '../lib/spec.generated'
import { REPO_ROOT } from '../lib/spec'
import { execSync } from 'node:child_process'

const dir = () => mkdtempSync(join(tmpdir(), 'ltw-proposal-'))
const base = (over: Partial<AssetSpec>): AssetSpec => ({ id: 'creep_runner_t1', class: 'creep', archetype: 'runner', tier: 1, body_plan: 'quadruped', rig: 'quadruped', source: { kind: 'generated', licence: 'own' }, game: {}, ...over })

describe('the game-data proposal', () => {
  it('reports a spec that agrees with the live roster and writes no patch', () => {
    const d = dir()
    const r = propose('creep_runner_t1', base({ game: { speed_tiles_per_s: 3.0, hp: 40, cost: 250 } }), d)
    expect(r.status).toBe('matches')
    expect(readFileSync(join(d, 'constants.patch'), 'utf8')).toMatch(/^# no change/)
    expect(readFileSync(join(d, 'gdd-stub.md'), 'utf8')).toContain('[proposed]')
    expect(readFileSync(join(d, 'tests.md'), 'utf8')).toContain('Refusal.TierLocked')
  })
  it('a higher tier that disagrees is a growth-rule question, not a per-tier constant', () => {
    const d = dir()
    const r = propose('creep_runner_t2', base({ id: 'creep_runner_t2', tier: 2, game: { hp: 999 } }), d)
    expect(r.status).toBe('growth-mismatch')
    expect(r.notes.join(' ')).toContain('base × growth^tier')
  })
  it('a new archetype becomes a base row derived by dividing out growth, as a unified diff', () => {
    const d = dir()
    const r = propose('creep_jelly_t2', base({ id: 'creep_jelly_t2', archetype: 'jelly', tier: 2, game: { speed_tiles_per_s: 2.0, hp: 100, cost: 500, income: 50, bounty: 40, answers: 'slow' } }), d)
    expect(r.status).toBe('new')
    const patch = readFileSync(join(d, 'constants.patch'), 'utf8')
    expect(patch).toContain('+++ b/packages/sim/data/creeps.json')
    expect(patch).toContain('"key": "jelly"')
    expect(patch).toContain('"hp": 20') // 100 / growth.hp (5)
    expect(patch).toContain('"cost": 100')
    expect(patch).toContain('"speed": 0.1')
    // Only additions: the existing entries are untouched.
    expect(patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).filter((l) => l.trim() !== '-    }')).toHaveLength(0)
  })
  it('a tower level with different numbers patches exactly that level', () => {
    const d = dir()
    const r = propose('tower_splash_l2', { id: 'tower_splash_l2', class: 'tower', archetype: 'splash', level: 2, body_plan: 'cannon', rig: 'turret', source: { kind: 'generated', licence: 'own' }, game: { damage: 25 } }, d)
    expect(r.status).toBe('changes')
    const patch = readFileSync(join(d, 'constants.patch'), 'utf8')
    expect(patch).toContain('"damage": 25')
    const removed = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
    expect(removed).toHaveLength(1) // exactly one line changes: level 2's
    expect(removed[0]).toContain('"damage": 20')
    expect(readFileSync(join(d, 'handoff.md'), 'utf8')).toContain('/rule-change')
  })
  it('never touches the constants, the sim or the GDD', () => {
    const d = dir()
    propose('creep_jelly_t1', base({ id: 'creep_jelly_t1', archetype: 'jelly', game: { hp: 5, cost: 10 } }), d)
    const status = execSync('git status --porcelain -- packages/sim docs/gdd.md', { cwd: REPO_ROOT, encoding: 'utf8' })
    expect(status.trim()).toBe('')
    expect(existsSync(join(REPO_ROOT, 'reports', 'art', '.diff-a.json'))).toBe(false)
  })
})

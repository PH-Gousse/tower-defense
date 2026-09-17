# Architecture decision records

One file per decision. Numbered, dated, and immutable once accepted — a decision that turns
out wrong gets a **new** ADR that supersedes it, never an edit to the old one.

Each record carries: context, decision, consequences, status.

Write one through `/decide`. A decision that changes a **game rule** also needs
`/rule-change`, which moves the GDD, the constants and the tests together.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-shared-deterministic-typescript-sim.md) | A shared deterministic TypeScript simulation | Accepted |
| [0002](0002-commands-not-state-over-the-wire.md) | Commands, not state, over the wire | Accepted |
| [0003](0003-replay-is-seed-plus-command-log.md) | A replay is a seed plus a command log | Accepted |
| [0004](0004-spectators-receive-the-command-stream.md) | Spectators receive the same command stream | Accepted |
| [0005](0005-ai-opponent-is-a-command-source.md) | The AI opponent is a command source | Accepted |
| [0006](0006-no-send-queue.md) | No send queue, no in-flight cap | Accepted |
| [0007](0007-creeps-loop-until-killed.md) | Creeps loop until towers kill them | Accepted |
| [0008](0008-leak-credits-the-sender.md) | A leak credits the sender a life | Accepted; its open questions settled and implemented by ADR-0032 |
| [0009](0009-income-clock-anchored-to-send-unlock.md) | The income clock starts when sending opens | Accepted — pending confirmation |
| [0010](0010-seeds-are-reserved-not-consumed.md) | Seeds are reserved, not consumed | Accepted — provisional |
| [0011](0011-dump-ts-is-a-declared-boundary.md) | `dump.ts` is a declared serialisation boundary | Accepted |
| [0012](0012-blocking-refusal-checks-spawn-not-creeps.md) | Sealing is checked against the spawn, not creep positions | Accepted; its teleport-instead-of-refuse half superseded by ADR-0023 |
| [0013](0013-three-tower-archetypes-no-tech-tree.md) | Three tower archetypes, three levels, no tech tree | Accepted; its creep roster superseded by ADR-0031 |
| [0014](0014-warcraft3-style-camera.md) | Warcraft 3-style camera: fixed yaw, zoom and pan only | Accepted; "fits the whole board" superseded by ADR-0024 |
| [0015](0015-procedural-look-inferred-from-two-ticks.md) | The look is procedural, and every effect is inferred from two ticks | Accepted — "no binaries" consequence superseded by ADR-0018 |
| [0016](0016-bot-reads-the-board-with-a-flood-model.md) | The bot reads the board with a flood model, and only for defence | Accepted |
| [0017](0017-sound-is-synthesised.md) | Sound is synthesised, fed by the same inferred events as the effects | Accepted — "no binaries" consequence superseded by ADR-0018 |
| [0018](0018-assets-are-generated-from-specs.md) | Assets are generated from specs, and the built files are committed | Accepted |
| [0019](0019-lane-is-16-wide-with-2x2-towers-and-1-tile-creeps.md) | The lane is 16 wide and Warcraft 3-length, towers are 2×2, creeps are 1×1 | Accepted — implemented 2026-09-13; `LANE_LENGTH` and `LANE_GAP` still `[proposed]` |
| [0020](0020-towers-anchor-on-the-creep-tile-grid.md) | Towers anchor on the 1-tile creep grid | Accepted |
| [0021](0021-creeps-do-not-collide.md) | Creeps do not collide with each other | Accepted — implemented 2026-09-15; the client offsets creeps by id (#49) |
| [0022](0022-spawns-spread-across-the-zone-with-a-fractional-setback.md) | Spawns spread across the zone and keep the fractional setback | Accepted; the cell order superseded by ADR-0030 |
| [0023](0023-placement-on-a-creep-is-refused.md) | A placement whose footprint holds a creep is refused | Accepted — implemented 2026-09-13; supersedes half of ADR-0012 |
| [0024](0024-camera-scrolls-and-zoom-caps-at-40-rows.md) | The camera scrolls, zoom caps at 40 rows, a minimap shows the rest | Accepted — implemented 2026-09-13; default moved 20 → 30 rows 2026-09-15; bindings `[proposed]`; the minimap part superseded by ADR-0029 |
| [0025](0025-balance-constants-are-void-until-retuned-on-the-new-lane.md) | Geometric conversion of the constants, then void until `/balance` | Accepted — conversion applied 2026-09-13; every §11 constant `[retune]` until `/balance` |
| [0026](0026-sudden-death-on-the-clock-ends-every-match.md) | Sudden death on the clock guarantees every match ends | Accepted — implemented 2026-09-14; sizing `[proposed]` `[retune]` |
| [0027](0027-lane-is-17-wide-and-100-rows.md) | The lane is 17 tiles wide and 100 buildable rows long | Accepted — implemented 2026-09-15; both `[proposed]`; supersedes the 16 and the 200 of ADR-0019 |
| [0028](0028-towers-take-time-to-acquire.md) | A tower takes time to acquire before its first shot | Accepted — implemented 2026-09-15; 10 ticks `[proposed]` `[retune]` |
| [0029](0029-no-minimap.md) | There is no minimap | Accepted — implemented 2026-09-15; supersedes the minimap half of ADR-0024 |
| [0030](0030-spawn-cells-are-scrambled.md) | Spawn cells are handed out in a fixed scrambled order | Accepted — implemented 2026-09-15; supersedes the cell order of ADR-0022 |
| [0031](0031-a-fourteen-creep-ladder-replaces-the-three-by-three-roster.md) | A fourteen-creep ladder replaces the three-by-three roster | Accepted — implemented 2026-09-16; supersedes the creep half of ADR-0013 |
| [0032](0032-a-leak-steals-a-life-losses-settle-before-gains.md) | A leak steals a life, and a tick settles losses before gains | Accepted — implemented 2026-09-17; settles ADR-0008 (#7) |

## Status vocabulary

- **Accepted** — in force. The code either matches it or has a tracked issue saying it does not.
- **Accepted — not implemented** — the decision is made, the code disagrees, and that gap is
  a bug with an issue against it. Never resolved by quietly editing the ADR.
- **Accepted — pending confirmation** — the code does this, and it has been written up so it
  can be confirmed or overturned deliberately rather than discovered later.
- **Accepted — provisional** — correct given something that is currently missing. Carries an
  explicit trigger for revisiting.
- **Superseded by ADR-NNNN** — replaced. The old file stays.

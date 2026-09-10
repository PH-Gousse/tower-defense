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
| [0008](0008-leak-credits-the-sender.md) | A leak credits the sender a life | Accepted — **not implemented** |
| [0009](0009-income-clock-anchored-to-send-unlock.md) | The income clock starts when sending opens | Accepted — pending confirmation |
| [0010](0010-seeds-are-reserved-not-consumed.md) | Seeds are reserved, not consumed | Accepted — provisional |
| [0011](0011-dump-ts-is-a-declared-boundary.md) | `dump.ts` is a declared serialisation boundary | Accepted |
| [0012](0012-blocking-refusal-checks-spawn-not-creeps.md) | Sealing is checked against the spawn, not creep positions | Accepted — pending confirmation |
| [0013](0013-three-tower-archetypes-no-tech-tree.md) | Three tower archetypes, three levels, no tech tree | Accepted |
| [0014](0014-warcraft3-style-camera.md) | Warcraft 3-style camera: fixed yaw, zoom and pan only | Accepted |

## Status vocabulary

- **Accepted** — in force. The code either matches it or has a tracked issue saying it does not.
- **Accepted — not implemented** — the decision is made, the code disagrees, and that gap is
  a bug with an issue against it. Never resolved by quietly editing the ADR.
- **Accepted — pending confirmation** — the code does this, and it has been written up so it
  can be confirmed or overturned deliberately rather than discovered later.
- **Accepted — provisional** — correct given something that is currently missing. Carries an
  explicit trigger for revisiting.
- **Superseded by ADR-NNNN** — replaced. The old file stays.

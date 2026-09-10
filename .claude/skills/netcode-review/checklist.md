# Netcode review checklist

Seven sections. Each names the failure it exists to catch, because a checklist item without
its failure mode gets skimmed.

## 1. Command serialisation and versioning

- [ ] Every field of every `Command` variant survives a round trip through the wire format.
- [ ] Commands are validated by **shape** before use (`validateShape` in `wire.ts`), and an
      invalid one is refused rather than coerced.
- [ ] `PROTOCOL_VERSION` bumps when the wire format changes.
- [ ] `versionsMatch` gates peers on **data** versions too — two clients whose towers deal
      different damage have already desynced, they just do not know it yet.
- [ ] Enum values are not renumbered. A shifted ordinal silently reinterprets every stored
      replay and every in-flight command.

**Catches:** a peer on an older build joining and diverging on tick 1.

## 2. Tick alignment and input delay

- [ ] A command is stamped for a tick the sender **has not yet simulated** and cannot have
      promised to be empty.
- [ ] `delay` is negotiated once per match and never changes mid-match. A moving delay means
      the two clients disagree about which tick a command belongs to.
- [ ] A seat that already claimed a tick moves to the next free one rather than dropping the
      input — drag-placing a run of towers is the core verb.
- [ ] The local client does **not** apply its own command early. Prediction draws a ghost;
      it does not advance state.

**Catches:** the same command applied on different ticks by the two clients.

## 3. Desync hash exchange

- [ ] The hash for tick N is taken **after** stepping N, on both sides. Same convention, or
      every comparison is off by one.
- [ ] Prediction and ghosts never enter the hash.
- [ ] A divergence **stops** the driver. There is no resync, deliberately — adopting the
      peer's state hides the bug that caused it.
- [ ] `no-overlap` is reported as the stall it is, not as a desync.
- [ ] The dump carries enough to replay: seed, command log, both hash rings, balance data,
      build id.

**Catches:** two clients quietly watching different matches.

## 4. Reconnection and resync

- [ ] Not built. Confirm the diff does not pretend otherwise.
- [ ] A dropped socket produces a clear message, not a frozen board.
- [ ] Nothing added assumes state can be re-fetched mid-match.

**Catches:** a half-built reconnect that resyncs by copying state, which would make a desync
invisible instead of fatal.

## 5. Server-side refusal matches client-side

- [ ] Every `Refusal` the sim can produce has a server-side counterpart with the same
      meaning. **Issue #9: they are currently two independent enums.**
- [ ] The relay refuses a command for the same reasons the sim would, and says which.
- [ ] A refusal reaches the originating client and fades the ghost with the reason.
- [ ] Refusal is checked **before any gold moves**, on both sides.

**Catches:** a command accepted locally, refused remotely, and the two states parting.

## 6. Spectator stream

- [ ] A spectator receives the same command stream, with no spectator-specific protocol
      (ADR-0004).
- [ ] No state snapshots. A spectator simulates.
- [ ] Joining mid-match needs the log from tick 0 — confirm nothing assumes otherwise.

**Catches:** spectating becoming a second source of truth.

## 7. No state where commands would do

- [ ] Nothing in the protocol carries `GameState` or any part of it.
- [ ] Watermarks (`Kind.None`) carry a tick, not a state.
- [ ] Server-authoritative-looking additions are flagged: they may be right, but they are an
      architecture decision (ADR-0002) and belong in `/decide`.

**Catches:** the design quietly turning into state replication, one field at a time.

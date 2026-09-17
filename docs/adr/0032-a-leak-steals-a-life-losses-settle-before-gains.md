# ADR-0032 — A leak steals a life, and a tick settles losses before gains

- **Date:** 2026-09-17
- **Status:** Accepted
- **Settles:** the two questions [ADR-0008](0008-leak-credits-the-sender.md) left open (issue #7).

## Context

ADR-0008 confirmed that a leak credits the sender a life, and left two things undecided:
whether lives may exceed the starting 20, and how the gain interacts with "first to zero
loses".

The second is not academic. `step` resolves lanes in index order, and `leak()` ended the
match the moment a defender reached zero, in the middle of the tick. With a credit added,
a same-tick exchange would be decided by lane order. Player 0 losing their last life in
lane 0 would end the match before player 1's lane could hand player 0 a life back. That
is a seat advantage, and invariant 4 exists to stop ordering from deciding outcomes.

## Decision

The user's words: **"when a creep leaks it steals a life from the opponent"**, with
**losses first, then gains**.

1. **A leak is a transfer, not a gain.** The sender gains exactly the life the defender
   loses, so a match's lives are conserved.
   - **No cap.** A player may hold more than the starting 20. Capping would destroy a
     stolen life rather than move it.
   - **There is nothing to steal from an empty purse.** Three creeps leaking into a lane
     whose owner has 1 life steal 1, not 3.
   - Every leak still counts in the defender's `leaks` statistic.
2. **A tick settles lives once, after every lane has moved:**
   1. **Losses:** each defender loses one life per leak this tick, floored at zero. What
      was actually removed is what was stolen.
   2. **Decide:** anyone at zero has lost; both at zero is a draw.
   3. **Gains:** each sender is credited what was stolen from their opponent, only if the
      match is still being played. A match decided on this tick's losses ends on those
      losses, and nobody's final lives move afterwards.

   Losses and gains are summed per player and applied as whole steps, so no ordering
   inside the tick, of lanes or of creeps, can change the result.

**Rejected, with reasons:**
- *Cap at 20.* A credit to a full purse would vanish, which contradicts "steals". It
  would also mean the rule does nothing for a player who has not yet leaked.
- *Net gains and losses per tick.* A player at 1 who loses one and steals one would
  survive. The user chose that reaching zero is final.
- *As they happen, in lane order.* The smallest diff, but lane 0 always resolves first,
  so a same-tick exchange favours a seat.

## Consequences

- **Lives are a shared pool of 40 that moves between players.** Every leak is a two-life
  swing. The runaway-leader concern ADR-0008 recorded is overruled, not answered, and
  should be measured: the bot presets and the balance batch are suspect until re-run.
- **A leader can bank lives without limit.** The HUD shows a plain number, so nothing on
  screen assumes 20 is the most.
- `hashState` already covers `lives` and `leaks`, so there is no hash schema change. But
  lives now follow a different path, so every stored replay and golden fixture that
  contains a leak will move, and must be regenerated with this ADR as the reason.
- The bot's lethal-wave check compares a wave's predicted leaks with the opponent's
  current lives. It stays correct: it does not model the attacker's own gains, which
  cannot save a defender who reaches zero.

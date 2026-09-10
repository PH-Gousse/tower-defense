# Ship checklist

Stop at the first failure. Do not proceed to the next gate.

## Before anything

- [ ] `git status` clean
- [ ] On a branch, or deliberately on `main`
- [ ] `git log --oneline origin/main..HEAD` — you know what is shipping

## Gates

```sh
pnpm test                        # ~25s, 366 tests
pnpm typecheck                   # ~2s
pnpm lint                        # ~1s — the determinism arithmetic/ordering guard
pnpm determinism-check           # ~3.5s
pnpm replay-verify               # ~1.2s
bun run scripts/golden-jsc.ts    # cross-engine — the only one
pnpm build                       # tsc --noEmit && vite build
npx wrangler deploy --dry-run    # from packages/server
```

- [ ] **test** — a failure here is not a flake until you have run it twice
- [ ] **typecheck**
- [ ] **lint** — never `--fix` your way past this one; it is the determinism guard
- [ ] **determinism-check** — check `distinctFinals`, not just PASS. A pass covering three
      distinct matches is a weaker pass than it looks.
- [ ] **replay-verify** — a break here is `/replay-verify`'s job to interpret, not something
      to regenerate past
- [ ] **golden-jsc** — needs `bun`. If bun is missing, this gate is **not run**, and the
      release has no cross-engine evidence. Say that; do not skip silently.
- [ ] **client build**
- [ ] **relay dry-run**

`pnpm bench-scene` exits non-zero by design (stub, issue #15). Not a gate. Mention it.

## Deploy — ask first

- [ ] Asked, in chat, and got a clear yes
- [ ] Said what will break: **a relay deploy ends every live match**, and there is no
      reconnect (`docs/gdd.md`, README "Not built yet")
- [ ] Client: pushed to `main`, which triggers `.github/workflows/deploy.yml` → GitHub Pages
- [ ] Relay: `pnpm --filter @ltw/server deploy`

## Smoke test the deployed relay

Against the **deployed** URL. A local `wrangler dev` proves the code, not the deployment.

- [ ] `GET /new` returns a room code
- [ ] A WebSocket connects to that room
- [ ] The `welcome` message arrives with a seat
- [ ] A second connection is seated as the other player
- [ ] `start` arrives with a delay and a seed
- [ ] A command sent by one client comes back to both

`pnpm --filter @ltw/harness live` drives two real lockstep clients through a relay. Point it
at the deployed URL rather than `wrangler dev` for a genuine smoke test.

> Note: `live-duel.mts` is not typechecked and not in CI (issue #16). It is the only thing
> that exercises the Durable Object adapter. Treat a failure here as real until proven
> otherwise.

## Tag

- [ ] `git tag -a vX.Y.Z -m "<what shipped, in prose>"`
- [ ] Asked before pushing the tag
- [ ] `git push origin vX.Y.Z`

## After

- [ ] The finish block printed, including every step after a stop
- [ ] Issues opened for anything found and not fixed

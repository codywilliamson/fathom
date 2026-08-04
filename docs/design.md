# fathom — design

a tailnet PWA that shows claude code usage across every machine cody works on,
built for an always-on fire hd 10 kiosk.

scaffolded from shipwright (`./new-tool.sh fathom 4950`), so it inherits the
house stack, security model, service worker, and design language. this doc
covers only what is specific to fathom.

## the problem

claude code runs on two machines — this laptop (linux) and a windows desktop.
usage data lives in per-machine `~/.claude/projects/**/*.jsonl` transcripts, and
rate-limit windows live behind an account-scoped api. no single place shows
"how much have i used, and can i keep going".

## architecture

one bun service on the laptop, port 4950, systemd user unit, joined to the
harbormaster fleet. it owns the database and the dashboard. the windows desktop
runs a small agent that pushes its parsed usage over the tailnet.

```
windows desktop                        laptop (this machine)
┌──────────────────────┐               ┌─────────────────────────────────┐
│ ~/.claude/projects/  │               │ ~/.claude/projects/             │
│         │            │               │         │                       │
│   agent/agent.ts     │               │   src/jsonl.ts (local tail)     │
│   (task scheduler,   │  POST         │         ↓                       │
│    every 2 min)      │──/api/v1/─────▶  src/store.ts (bun:sqlite)      │
└──────────────────────┘  ingest       │         ↑                       │
                                       │   src/ratelimit.ts (oauth poll) │
                                       │         ↓                       │
                                       │   src/summary.ts → SSE + REST   │
                                       └────────────┬────────────────────┘
                                                    │ tailnet
                                              ┌─────▼──────┐
                                              │ fire hd 10 │
                                              │ fully kiosk│
                                              └────────────┘
```

## data sources

### 1. jsonl transcripts (the reliable one)

`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. every assistant turn
writes a line carrying `message.id`, `message.model`, `message.usage`,
`sessionId`, `cwd`, and `timestamp`.

**claude code rewrites the same assistant line repeatedly while streaming.** in a
sampled transcript, 299 assistant lines carried only 107 distinct `message.id`
values — naive summing over-counts tokens by ~2.8x. `message.id` is therefore
the dedup key, enforced as the sqlite primary key so re-ingest is idempotent.

parsing is incremental: `store` keeps a byte cursor per file so a poll only
reads what was appended. this matters — there are ~380 transcripts locally.

### 2. unified rate-limit headers (the quota gauges)

the 5-hour and weekly quota windows come from the
`anthropic-ratelimit-unified-*` **response headers** on a normal
`POST /v1/messages` call. we send a deliberately minimal probe — cheapest
model, `max_tokens: 1` — purely to read the headers:

```
anthropic-ratelimit-unified-5h-utilization: 0.26
anthropic-ratelimit-unified-5h-reset:       1785817800
anthropic-ratelimit-unified-7d-utilization: 0.19
anthropic-ratelimit-unified-7d-reset:       1786082400
anthropic-ratelimit-unified-status:         allowed
```

**why not `GET /api/oauth/usage`**, which is the obvious candidate and was the
original design: it's real and in scope for the token claude code already holds
(an out-of-scope endpoint returns 403; this one returns 429), but it has a tiny
budget on a long window. six probes spaced 45s apart all returned 429, and a
later 429 carried `retry-after: 1963` — about 33 minutes. any poll frequent
enough to be useful keeps that budget permanently spent, so the gauge never
fills. the headers ride an ordinary inference call instead and are always
current.

the tradeoff is that each poll costs a handful of tokens. that's the price of
having live quota numbers at all; `FATHOM_RATELIMIT_INTERVAL_SEC` controls it.

other load-bearing details:

- **never refresh the token ourselves.** claude code owns that refresh; racing it
  risks invalidating the refresh token. read `~/.claude/.credentials.json` fresh
  on every poll and, if it's expired, degrade.
- **a 429 still carries the headers** — and "you are capped" is precisely the
  interesting state, so we read them before treating the response as a failure.
- we store the captured header map, not a parsed shape, so a header we don't map
  yet is still in the snapshot rather than silently dropped.
- cache the last good snapshot and render it with a visible age. a stale gauge
  beats a blank one, and `subscriptionType`/`rateLimitTier` come from a local
  file read that works even when the network doesn't.
- if the headers ever stop appearing, `normalizeWindows()` returns `[]` and the
  ui falls back to rolling token volume from the transcripts rather than showing
  a fabricated percentage.

### 3. cost

derived, not reported. `shared/pricing.ts` holds per-model per-MTok rates and
computes usd at parse time. cache reads bill at ~0.1x input and cache writes at
1.25x, which dominates real claude code usage — ignoring them would badly
misreport.

cody is on a max subscription, so **these dollar figures are notional** — what
the same tokens would have cost on the api. the ui labels them that way rather
than implying real spend.

## components

| module | job |
|---|---|
| `shared/types.ts` | the `/api/v1` contract. backend, web, and the windows agent all import it. |
| `shared/pricing.ts` | model → per-token rates; `costOf(model, tokens)`. |
| `shared/jsonl.ts` | parse transcript lines → `UsageEvent[]`, deduped by `message.id`. pure, no i/o. used by both the server and the windows agent. |
| `src/store.ts` | `bun:sqlite`. events table keyed on `messageId`, file cursors, ratelimit snapshot. all queries live here. |
| `src/scanner.ts` | walks `~/.claude/projects`, tails changed files through `shared/jsonl.ts`, writes to store. |
| `src/ratelimit.ts` | slow poller for the oauth endpoint + credentials reader. |
| `src/summary.ts` | builds `SummaryResponse` from the store. rollups, active sessions, machine status. |
| `src/stream.ts` | SSE fan-out; pushes a fresh summary when anything changes. |
| `src/server.ts` | stays thin — route table only, per the house SRP rule. |
| `agent/agent.ts` | standalone windows pusher. parses locally, POSTs deltas. |

## api

- `GET /api/v1/health` — unchanged from the template.
- `GET /api/v1/summary` — the whole dashboard payload in one shot.
- `GET /api/v1/stream` — SSE, one `summary` event type. client replaces state.
- `POST /api/v1/ingest` — the windows agent. idempotent on `messageId`.

## the windows bridge

a bun script under `agent/`, run by task scheduler every 2 minutes. it parses
its own `~/.claude/projects` with the same `shared/jsonl.ts`, keeps its own
cursor file, and POSTs new events.

why push and not pull: the laptop is the one that sleeps. a pull design breaks
whenever the desktop is off *or* the laptop can't reach it; push degrades to
"retry next tick", and since the jsonl files are the durable source, nothing is
ever lost — a missed window just means a bigger batch later.

auth: the tailnet is the perimeter per house rules, but ingest is a write route,
so it additionally requires a shared `FATHOM_INGEST_TOKEN`. this is
defense-in-depth against another tailnet device posting by accident, not a
security boundary. when the var is unset the check is skipped, matching the
template's "optional hardening" style.

## the kiosk display

landscape 1280x800, deep-sea instrument panel language, tokens from
`web/src/style.css`. **the manifest's `orientation` flips from `portrait` to
`landscape`** — the template default is wrong for a docked tablet.

layout, glanceable from across a room:

- a row of quota progress-bar cards, one per window the unified rate-limit
  headers report (5-hour, weekly · all models, and any window anthropic adds
  later — the grid is generic over however many come back). falls back to
  rolling token volume, staleness noted, when the api has no quota data.
- usage breakdown bars by model and by project over the last 30 days, plus
  24h/7d/30d stat tiles — swapped in for the old token/cost line sparklines,
  which read as noise at kiosk viewing distance and didn't answer "where did
  it go".
- a per-machine strip: laptop / desktop, online lamp, active session count,
  30-day cost.
- a live session list: project, model, tokens, age.

the tablet is a display, not a control surface — no write actions in the ui.
its own accent color distinguishes it from helm/buoy on the home screen.

## what this deliberately does not do

- no auth, no public exposure, no tls (tailscale handles transport).
- no historical downsampling. ~40k rows today; sqlite does not care.
- no alerting. buoy already owns notifications; a display that pages you is two
  tools wearing one coat.
- no control of claude code from the tablet. porthole already does that.

## risks

| risk | handling |
|---|---|
| oauth usage endpoint never returns 200 | rolling jsonl windows carry the display; gauge shows unavailable. shipped behavior, not a failure. |
| response schema differs from the guess | normalizer is one function; raw payload is stored. |
| laptop asleep when desktop pushes | agent retries; jsonl is durable. |
| tablet battery swelling while permanently charging | called out in the tablet guide with mitigations. |
| public repo leaking data | nothing under `~/.claude` is committed; `data/` gitignored; secrets only in `.env`. verified by scan before publish. |

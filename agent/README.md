# fathom windows agent

standalone bun script that runs on cody's windows desktop. it parses that
machine's `~/.claude/projects/**/*.jsonl` transcripts and pushes new usage
events to the fathom server on the laptop over tailscale.

one run = one sync pass: walk transcripts -> read only new bytes since last
run -> parse -> POST to `/api/v1/ingest` -> advance the cursor only for what
the server confirmed. failure (laptop asleep, network blip) just means the
cursor doesn't move and the next scheduled run retries — re-sending is always
safe because the server dedupes on `messageId`. see the top of `agent.ts` and
`docs/design.md`'s "the windows bridge" section for the full reasoning.

no dependencies beyond bun itself.

## setting it up on windows

full walkthrough, written for doing this without me there: `docs/windows-setup.md`.

## env vars

| var | required | default | purpose |
|---|---|---|---|
| `FATHOM_SERVER` | yes | — | base url of the laptop's fathom server, e.g. `http://laptop-hostname:4950` |
| `FATHOM_MACHINE` | no | `os.hostname()` | machine id shown on the dashboard |
| `FATHOM_INGEST_TOKEN` | no | unset | sent as `x-fathom-token`; only needed if the server has one configured |
| `FATHOM_CLAUDE_DIR` | no | `os.homedir()/.claude` | root to scan for `projects/**/*.jsonl` |
| `FATHOM_CURSOR_FILE` | no | `%LOCALAPPDATA%\fathom\cursors.json` (windows) or `~/.fathom/cursors.json` | where byte cursors persist between runs |

## running it once

```sh
FATHOM_SERVER=http://laptop-hostname:4950 bun agent/agent.ts
```

prints one summary line (events found/sent/accepted/duplicates/errors) and
exits 0 on success (including "nothing new"), non-zero on failure.

## tests

```sh
bun test agent/
```

pure logic only — cursor math, batch chunking, directory walking — all
against temp dirs. nothing touches the network or the real `~/.claude`.

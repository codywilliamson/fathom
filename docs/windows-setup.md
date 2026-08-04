# fathom — windows agent setup

setting up the push agent on cody's windows desktop so it feeds usage into
fathom on the laptop. written to be followed solo, no laptop-side help
required. see `agent/README.md` for the env var reference and
`docs/design.md` ("the windows bridge") for why this is push, not pull.

## 1. install bun

open powershell and run:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

this installs bun to `%USERPROFILE%\.bun\bin` and adds it to PATH. **PATH
changes don't apply to the terminal you ran the installer in** — open a new
powershell window and confirm:

```powershell
bun --version
```

if that fails in the new window too, log out and back in (or reboot) — PATH
propagation to explorer-launched shells is sometimes delayed.

## 2. get the code onto the machine

```powershell
git clone <fathom-repo-url> C:\fathom
cd C:\fathom
```

only `agent\` and `shared\` are used at runtime — the agent has **zero
dependencies**, so there is no `bun install` step and no `node_modules` to
worry about. you can ignore `src\`, `web\`, and everything else; they don't
run on this machine.

## 3. find the laptop's tailscale address

on the laptop:

```sh
tailscale ip -4
```

or use the MagicDNS name shown in the tailscale admin console (e.g.
`laptop-hostname`) — it's usually more stable than the IP across reconnects.

from windows, verify the laptop is reachable and fathom is up:

```powershell
curl.exe http://laptop-hostname:4950/api/v1/health
```

**use `curl.exe`, not `curl`.** in powershell, `curl` (no extension) is an
alias for `Invoke-WebRequest`, which has different flags and output — it'll
mostly work for a plain GET like this but will confuse you the moment you try
to pass real curl flags. `curl.exe` is the actual curl binary. you should get
back something like `{"ok":true,"name":"fathom",...}`.

if that hangs or errors, fix connectivity before going further — nothing past
this point will work either.

## 4. set the environment variables

quick, this-session-only (for the manual test run in step 5):

```powershell
$env:FATHOM_SERVER = "http://laptop-hostname:4950"
$env:FATHOM_MACHINE = "desktop"
# only if the laptop's fathom has a token configured:
# $env:FATHOM_INGEST_TOKEN = "..."
```

persistent, so task scheduler (which starts a fresh environment) can see
them:

```powershell
setx FATHOM_SERVER "http://laptop-hostname:4950"
setx FATHOM_MACHINE "desktop"
setx FATHOM_INGEST_TOKEN "..."   # skip if unset on the server
```

**`setx` does not update your current shell.** it writes to the registry for
future processes. open a new powershell window before relying on it (or just
keep using `$env:` in the same window for step 5, then trust `setx` for the
scheduled task).

alternative: System Properties → Advanced → Environment Variables → New
(under "User variables") — same effect as `setx`, if you'd rather click.

`FATHOM_CLAUDE_DIR` and `FATHOM_CURSOR_FILE` are optional; leave them unset
unless you have a reason (non-default claude install location, or you want
cursors somewhere other than `%LOCALAPPDATA%\fathom\cursors.json`).

## 5. first manual run

run it in the foreground so you can read what happens:

```powershell
cd C:\fathom
bun agent\agent.ts
```

expect the **first** run to take a while and send a real backlog — it's
scanning every transcript this machine has ever written, not just recent
ones. it's chunked into batches of 1000 events per POST so this doesn't send
one giant request; you'll see the summary line report totals once it's done,
e.g.:

```
fathom-agent: found=4213 sent=4213 accepted=4213 duplicates=0 errors=0 ok
```

exit code 0 means success (`echo $LASTEXITCODE` to check). run it a second
time immediately — it should report `found=0` (nothing new) and still exit 0,
which confirms the cursor was actually persisted.

## 6. task scheduler setup

run every 2 minutes, whether the user is logged on or not.

### option a — one-liner

find bun's absolute path first (task scheduler doesn't reliably inherit your
user PATH):

```powershell
(Get-Command bun).Source
```

then, using that path:

```powershell
schtasks /create /tn "fathom-agent" /tr "'C:\Users\cody\.bun\bin\bun.exe' agent\agent.ts" /sc minute /mo 2 /ru SYSTEM /rl LIMITED /f
```

this creates the task but **doesn't set the working directory**, which the
CLI form can't do — set it via the GUI (option b, step 4) or accept that the
agent will fail to find `agent\agent.ts` relative to nothing. easiest fix:
edit the task afterward in the GUI and fill in "Start in", or just use the
GUI from the start.

### option b — gui (recommended, the CLI form above is fiddly)

1. open **Task Scheduler** → **Create Task** (not "Create Basic Task" — you
   need the extra tabs).
2. **General tab**: name it `fathom-agent`. select **"Run whether user is
   logged on or not"**. do **not** check "Run with highest privileges" — it
   doesn't need admin rights and asking for them just adds a UAC prompt risk.
3. **Triggers tab**: New → Begin the task **On a schedule** → Daily, repeat
   task every **2 minutes** for a duration of **Indefinitely**.
4. **Actions tab**: New →
   - Program/script: the absolute path to `bun.exe`, e.g.
     `C:\Users\cody\.bun\bin\bun.exe`
   - Add arguments: `agent\agent.ts`
   - Start in: `C:\fathom`
5. **Settings tab**: check **"If the task fails, restart every"** → 1 minute,
   up to 3 attempts. leave "Stop the task if it runs longer than" at a
   sensible cap (e.g. 5 minutes) so a hung run can't pile up alongside the
   next trigger.
6. save. you'll be prompted for the windows account password (required for
   "run whether logged on or not").

## 7. verify it worked

- open the fathom dashboard (kiosk or `http://laptop-hostname:4950`) and
  confirm the desktop machine shows as **online** in the per-machine strip.
- in Task Scheduler, select the `fathom-agent` task and check **Last Run
  Result** — `(0x0)` is success. anything else, see troubleshooting below.
- right-click the task → **Run** to trigger it on demand instead of waiting
  for the next 2-minute tick.

## troubleshooting

**laptop asleep / unreachable** — expected, not a bug. the agent exits
non-zero, the cursor doesn't move, and the next tick retries. nothing is
lost; the jsonl transcripts are the durable source. don't "fix" this.

**401 / token mismatch** — the laptop's fathom has `FATHOM_INGEST_TOKEN` set
to something different (or unset) from this machine's. confirm both sides
match, or that the laptop doesn't require one.

**wrong `FATHOM_SERVER`** — re-run the `curl.exe` health check from step 3.
if that fails, this isn't an agent problem yet — it's network/dns/config.

**bun not found under task scheduler (very common)** — the task runs in a
minimal environment that often doesn't have your interactive PATH. use the
**absolute path** to `bun.exe` in the task's Program/script field (see step
6), not just `bun`. verify with `(Get-Command bun).Source`.

**force a re-scan of one file** — open `%LOCALAPPDATA%\fathom\cursors.json`,
delete the entry for that file's path (or delete the whole file to re-scan
everything), and run the agent again. re-sending is always safe — the server
dedupes by `messageId` — so this never double-counts.

## checklist

- [ ] `bun --version` works in a fresh powershell window
- [ ] `curl.exe http://laptop-hostname:4950/api/v1/health` returns `ok: true`
- [ ] env vars set via `setx` (verified in a **new** shell)
- [ ] manual run exits 0 and reports a nonzero `found` on the first pass
- [ ] second manual run reports `found=0` and still exits 0
- [ ] task scheduler task created, "run whether logged on or not", 2-minute
      interval, absolute path to `bun.exe`
- [ ] dashboard shows the desktop machine online
- [ ] Last Run Result in task scheduler is `(0x0)`

# fire hd 10 wall kiosk setup

turning a fire hd 10 (10.1") into an always-on kiosk that shows fathom over your
tailnet. covers fire os 7 (android 9) and fire os 8 (android 11) — steps differ
in a few places, called out below.

not verified on real hardware — compiled from official docs and current how-tos.
see "could not verify" at the end before you commit to a config.

---

## 1. identify your device

fire hd 10 (10.1") has shipped in three generations, and the gen determines your
fire os version:

| generation | year | fire os | android base |
|---|---|---|---|
| 9th gen | 2019 | fire os 7 | android 9 |
| 11th gen | 2021 | fire os 7 (upgradable) | android 9 |
| 13th gen | 2023 | fire os 8 | android 11 |

1. `settings > device options` (or `about fire tablet`) — the **device model** line
   gives the generation, e.g. "fire hd 10 (11th generation)".
2. `settings > device options > system updates` shows the **fire os version**.
3. android version lives under `settings > device options > about fire tablet >
   software info` (naming varies slightly by build).

why it matters:

- developer options unlock differs — fire os 7 shows "enable adb", fire os 8
  shows "usb debugging".
- fire os 8 (android 11) is stricter about background/battery restrictions and
  about experimental status-bar removal (step 4).
- both run tailscale and fully kiosk fine; this isn't a blocker either way.

sources: [amazon device specs](https://developer.amazon.com/docs/device-specs/ft-device-specifications-firehd-models.html),
[fire hd 10 gen comparison](https://kindlefireforkid.com/fire-hd-10-2023-vs-fire-hd-10-2021/)

---

## 2. install tailscale

fire os has no play store, but it does have the **amazon appstore**, and
tailscale publishes there — easier than most sideloading guides assume.

### 2a. amazon appstore (easiest, official)

1. open the built-in **appstore** app (uses your amazon account; no google
   account needed).
2. search "tailscale" and install — there's an official
   [amazon appstore listing](https://www.amazon.com/Tailscale-Inc/dp/B0D38TRB3N).
3. this is the path tailscale documents for fire devices: ["most fire tablets
   released after 2018"](https://tailscale.com/docs/install/amazon-fire) are
   supported. open it, tap **OK** on the connection request, **get started**,
   accept the vpn config prompt, then **log in**.

### 2b. sideload the apk (fallback)

where to get it, in order of trust:

1. **tailscale's own package server** — `https://pkgs.tailscale.com/stable/#android`,
   the universal apk. most trustworthy non-store source since it's tailscale's
   infra. it does **not** auto-update, so re-download periodically.
2. **f-droid build** — exists, but per tailscale's repo it is "not released,
   updated, or verified by the tailscale team."
3. **apkmirror** — third-party mirror. if you use it, verify the publisher is
   "Tailscale Inc." don't use random apk aggregators.

enable unknown sources (per-app on fire os, not one global switch):

1. `settings > security & privacy > apps from unknown sources`
2. toggle on the app you downloaded with (silk, or your file manager)
3. open the apk from downloads → **install**

### 2c. sign in

no google account by default, so use the SSO flow:

- on the login screen choose **sign in with other** and pick your identity
  provider, or **sign in with google** if your tailnet is tied to a personal
  google account.
- or **scan the QR code** with your phone, authenticate there, and the tablet
  logs in automatically.

auth-key login is **not** in the android app UI — it's an open feature request
([tailscale#8497](https://github.com/tailscale/tailscale/issues/8497)), so don't
plan around it.

if your tailnet has device approval on, approve the tablet in the admin console
or it won't be reachable.

### 2d. always-on vpn

stock android puts this at `settings > vpn > (gear) > always-on vpn`. **fire os
reskins settings heavily and may not expose it** — unverified. tailscale stays
connected fine without it; the toggle only adds a hard block if the vpn drops,
which is arguably wrong for a kiosk (you'd rather show a stale dashboard than go
fully offline).

### 2e. battery optimization exclusion

so the tunnel survives idle:

1. `settings > apps & notifications > manage all applications > tailscale >
   battery` → **don't optimize** / **unrestricted**.
2. fire os hides this screen on some builds. if there's no battery tab, lean on
   `developer options > stay awake` (step 5) plus fully kiosk's keep-screen-on —
   a screen that never sleeps makes the doze cycle mostly moot.

---

## 3. browser choice

**silk is not viable for kiosk use.** no true fullscreen lockdown, no
restart-on-crash, no motion wake, no remote management, and amazon's own chrome
is always one idle tap away.

**sideload fully kiosk browser** ([fully-kiosk.com](https://www.fully-kiosk.com/)).
it's not on the appstore, so this always requires sideloading — get it from
fully-kiosk.com directly, not an aggregator.

why it beats a plain browser apk:

- true fullscreen lockdown (hides status/nav bars, blocks home/back gestures)
- keeps the screen on independent of system sleep
- motion-detection wake so the screen isn't lit 24/7
- remote admin web ui + REST api
- auto-start on boot, auto-reload if the page or connection dies — critical for
  something you won't babysit

free vs plus (~€8–12 one-time per device; check the
[live pricing page](https://license.fully-kiosk.com/license/?cmd=singleForm)):

| feature | free | plus |
|---|---|---|
| start url, launch on boot, keep screen on | yes | yes |
| auto reload on reconnect | yes | yes |
| hide status / nav bar | yes | yes |
| remote administration + REST api | no | **yes** |
| motion detection (wake on approach) | no | **yes** |
| screensaver / screen-off timer | no | **yes** |

for an unattended wall dashboard you want to check remotely and dim
intelligently, plus is effectively mandatory — remote admin and motion detection
are the reasons to use fully kiosk at all.

---

## 4. configure fully kiosk

open settings (swipe up with 3 fingers, or tap 7x, or use remote admin):

1. **web content > start url** — fathom on the tailnet, e.g.
   `http://<laptop-magicdns-name>:4950` or `http://100.x.y.z:4950`. see step 7
   for which to pick.
2. **device management > launch on boot** — on (free).
3. **device management > keep screen on** — on. also enable the advanced
   variant if offered.
4. **screensaver (plus)** — set a screen-off timer for dead hours, or leave at 0
   to stay fully on. pair with motion detection so it wakes when you walk up.
5. **web content > enable pull to refresh** — **off**. an accidental swipe-down
   on a wall display is pure annoyance.
6. **device management > auto reload on internet reconnect** — on. this is what
   recovers the dashboard after a wifi blip or tailscale reconnect.
7. **show status bar** / **show navigation bar** — both off.
8. **remote administration (plus)** — enable, set a password, note the port
   (default `2323`). **only expose this on the tailnet — never forward it
   publicly.** it's plain http by default and lets someone reload, reconfigure,
   or screenshot the device. reach it at `http://<tablet-tailscale-ip>:2323`.

---

## 5. keep it awake and sane

1. **remove lockscreen ads** — `settings > security & privacy > special offers`,
   toggle off. the toggle isn't on every device/region; the paid route is
   amazon's "manage your devices" page → select device → **remove offers**
   (roughly $15–25).
2. **enable developer options** — `settings > device options` → tap **serial
   number** ~7 times.
3. **stay awake while charging** — in developer options, toggle **stay awake**.
   applies only while plugged in; combine with fully kiosk's keep-screen-on.
4. **auto-updates** — there's no clean no-root way to block OS updates (that
   needs moving `otacerts.zip`). app-level is easy:
   `settings > apps & notifications > appstore > auto-update apps > off`.
   practical compromise: leave OS updates on, but re-check fully kiosk and
   tailscale after any update — amazon has changed background-app and vpn
   behavior between point releases.

---

## 6. physical setup — the battery swelling problem

be honest about this one. fire tablets are consumer devices with cheap lithium
cells, not designed to sit at 100% indefinitely. holding a li-ion battery at full
charge continuously — especially warm, mounted flat against a wall with no
airflow — accelerates gas buildup and is the most common cause of swelling
reported in kiosk/wall-mount forums. a swollen battery cracks screens, pushes
case seams open, and is genuinely fire-adjacent if ignored.

fire os has **no built-in charge limit**, so you can't fix this in software.
mitigations:

1. **smart-plug duty cycling** — put the charger on a smart plug and cut power
   for part of the day rather than trickle-charging at 100% forever. most
   practical fix.
2. **ventilation** — don't recess-mount flush against drywall; leave a gap.
3. **lower brightness** — less heat; fully kiosk can set brightness directly.
4. **inspect periodically** — a bulging screen, a case that no longer sits flush,
   or a battery percentage that stops moving are early warnings.
5. treat it as "when", not "if". budget for a battery or device replacement on
   kiosk duty.

---

## 7. troubleshooting

**magicdns hostname vs raw 100.x ip**

- magicdns (`http://<name>:4950`) is nicer but depends on the tablet using
  tailscale's resolver (`100.100.100.100`).
- if the hostname won't resolve while the tailnet is otherwise up, **use the raw
  `100.x.y.z` ip** — always works, sidesteps DNS entirely. worth hardcoding if
  you're setting this up once and walking away.
- confirm magicdns is on in the [admin console](https://login.tailscale.com/admin/dns).

**dashboard doesn't load**

1. does the tailscale app say "connected"?
2. is the tablet online in the [machines page](https://login.tailscale.com/admin/machines)?
3. try the raw ip in a normal browser tab to separate "tailscale broken" from
   "fully kiosk / start url broken".
4. curl the health endpoint from another tailnet device:
   `curl http://<laptop>:4950/api/v1/health`
5. if it worked for months then silently stopped, suspect **key expiry** —
   default is 180 days, after which the device drops off until re-authenticated.
   for a kiosk, open the device's row in the admin console → **disable key
   expiry**.

**verify tailscale is actually connected**

- open the app and check its status screen
- from another tailnet device: `tailscale ping <tablet-hostname>`
- admin console shows a recent "last seen" and the expected ip

---

## verify it worked

- [ ] `settings > device options` shows the expected generation and fire os version
- [ ] tailscale says "connected" and the tablet is online in the admin console
- [ ] fathom loads in fully kiosk via magicdns name or raw 100.x ip
- [ ] reboot — fully kiosk auto-launches straight into fathom, no home-screen detour
- [ ] pull wifi for 30s — dashboard recovers on its own, no manual reload
- [ ] status bar, nav bar, and pull-to-refresh all gone
- [ ] screen stays on (or wakes on motion, if configured)
- [ ] remote admin at `http://<tablet-ip>:2323` loads from another tailnet device
      and is **not** reachable from outside the tailnet
- [ ] lockscreen ads gone
- [ ] developer options "stay awake" on
- [ ] key expiry disabled for this device
- [ ] you have a charging plan that isn't "plugged in at 100% forever"

---

## could not verify — check these yourself

- **fire os always-on vpn toggle location (2d)** — exists on stock android;
  couldn't confirm whether or where fire os 7/8 exposes it. one source claimed
  amazon removed the native vpn ui in a recent release; unconfirmed.
- **whether "ignore battery optimizations" is reachable at all (2e)** — community
  reports say amazon hides it on some builds. test on-device.
- **fully kiosk plus price** — sources ranged €7.90 to $10.60; the live license
  page showed 8.90 € + tax when checked. confirm before buying.
- **fully kiosk "remove status bar (experimental)"** — reported to work fully
  only on android 10 and older. on fire os 8 you may still see a status bar
  sliver. test on-device.
- **developer-options unlock label** ("enable adb" vs "usb debugging") — differs
  by generation; not independently confirmed per-version.
- **amazon appstore tailscale availability in your region** — catalogs vary by
  marketplace. if missing, use the sideload path in 2b.
- none of this was tested on physical hardware. strong starting point, not a
  guarantee.

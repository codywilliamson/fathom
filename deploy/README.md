# deploy

fathom runs as a systemd **user** service, same as the rest of the fleet
(porthole, buoy, helm) — no root, no docker.

## install

```sh
cp deploy/fathom.service ~/.config/systemd/user/fathom.service
systemctl --user daemon-reload
systemctl --user enable --now fathom.service
```

bun loads `.env` from the working directory itself, so there's no
`EnvironmentFile=` in the unit — just make sure `.env` exists in
`/home/shockbirds/dev/fathom` before starting (`cp .env.example .env`).

linger is already enabled for this user (`loginctl enable-linger shockbirds`),
so the service keeps running across reboots without a login session. no need
to re-run it here.

## check it

```sh
systemctl --user status fathom.service
journalctl --user -u fathom.service -f
```

## update

```sh
git pull
bun install
bun run build
systemctl --user restart fathom.service
```

## fleet management

fathom is also manageable through the **harbormaster** MCP server alongside
the rest of the fleet — no need to ssh in for routine status checks, log
tails, or restarts.

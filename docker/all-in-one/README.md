# All-in-One Docker Deployment

One container runs the panel, SteamCMD, and the Project Zomboid dedicated
server together. This is what the maintainer runs in production, and the
most complete Docker path in this repo — pick it when you don't have a PZ
server running anywhere yet.

For the full walkthrough with verification checkpoints at every step, plus
how this path compares to the other two Docker paths, see
[`docs/install/docker.md`](../../docs/install/docker.md#path-a-all-in-one).
This file is the short version.

## Prerequisites

A Linux host with Docker Engine installed and `curl` available. The Docker
Compose plugin is **not** required on the host — the installer runs Compose
inside its own controller container.

## First install

Run this on the Docker host:

```sh
curl -fsSL https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/main/docker/all-in-one/bootstrap.sh | sh
```

To install a specific version instead of the latest release, pass it as an
argument:

```sh
curl -fsSL https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/main/docker/all-in-one/bootstrap.sh | sh -s -- 1.2.4
```

The script resolves the latest GitHub release (unless you passed one),
creates its state below `~/.local/state/zomboid-panel/` by default,
generates an updater token, builds the controller, and starts the stack. Set
`PANEL_HOME` or `BUILD_ROOT` before running it if you prefer a different
host location. It deliberately runs Docker Compose *inside* the controller
image, so the host does not need the Docker Compose plugin.

On first start, the container downloads Project Zomboid through SteamCMD —
this can take several minutes. Watch progress with:

```sh
docker logs -f zomboid-panel
```

The default URL is `http://localhost:3001`. Before accessing the panel from
another machine or through a reverse proxy, update `CORS_ORIGINS` in the
generated `.env` file (`<state dir>/build/ctx/.env`) to the exact browser
origin, then rerun the final command from the script.

The stack uses Docker named volumes for panel state, logs, the PZ
installation, and Zomboid save data. This keeps a default install
independent of a particular NAS or host filesystem layout, and means you
never need to configure `PUID`/`PGID` for this path — the container always
runs Project Zomboid internally as UID/GID `1000` and owns its own volumes.

The update controller has Docker socket access, but it is not exposed on a
host port. The panel can reach it only over the Compose network using the
token in `.env`.

## Updating

After the first installation, the panel Settings page can apply a newer
GitHub release. The action saves and stops Project Zomboid through RCON,
downloads the tagged source, rebuilds the panel image, recreates only the
panel service, and waits for its health check. A failed rollout restores the
previous source and image.

## Files in this directory

| File | Purpose |
| --- | --- |
| `bootstrap.sh` | Host-side installer — the one command in "First install" above |
| `docker-compose.yml` | The two-service stack (`panel` + `updater`) the installer and the Settings-page updater both run |
| `Dockerfile` | Builds the combined panel + SteamCMD + PZ image |
| `entrypoint.sh` | Container start script: installs PZ via SteamCMD if missing, then starts the panel as the `steam` user |
| `.env.example` | Reference for the variables in the generated `.env` — this path's `.env` is separate from the repo root's `.env.example`, which is for the [bind-mount path](../../docker-compose.yml) instead |
| `updater/` | The `zomboid-panel-updater` service — a small HTTP controller with Docker socket access that performs the rebuild-and-recreate described above |

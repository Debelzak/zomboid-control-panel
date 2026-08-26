# All-in-One Docker Deployment

This deployment runs the panel, SteamCMD, and the Project Zomboid dedicated server in one container. Use it when the panel needs direct process control and PanelBridge file IPC.

## First install

Run this on the Docker host:

```sh
curl -fsSL https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/main/docker/all-in-one/bootstrap.sh | sh
```

The script resolves the latest GitHub release, validates Docker and the host architecture, creates its state below `~/.local/state/zomboid-panel/`, generates the updater token, detects the host's LAN address, pulls the exact release images, and starts the stack. If a release image is not available yet, it builds that image locally from the downloaded release source instead. Set `PANEL_HOME` or `BUILD_ROOT` before running it if you prefer a different host location. It runs Docker Compose *inside* the controller image, so the host does not need the Docker Compose plugin.

The installer prints the detected LAN URL when it finishes and includes that address in `CORS_ORIGINS`. When using a reverse proxy, set `CORS_ORIGINS` and `TRUST_PROXY` before running the installer or update them in the generated `.env` file.

The stack uses Docker named volumes for panel state, logs, the PZ installation, and Zomboid save data. This keeps a default install independent of a particular NAS or host filesystem layout.

The Compose stack publishes the PZ game ports `16261/udp` and `16262/udp`
automatically. They do not need to be added to Compose by hand.

The update controller has Docker socket access, but it is not exposed on a host port. The panel can reach it only over the Compose network using the token in `.env`.

## Updating

After the first installation, the panel Settings page can apply a newer GitHub release. The action saves and stops Project Zomboid through RCON, downloads the tagged source, rebuilds the panel image, recreates only the panel service, and waits for its health check. A failed rollout restores the previous source and image.
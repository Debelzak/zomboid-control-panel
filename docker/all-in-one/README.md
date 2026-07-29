# All-in-One Docker Deployment

This deployment runs the panel, SteamCMD, and the Project Zomboid dedicated server in one container. Use it when the panel needs direct process control and PanelBridge file IPC.

## First install

Run this on the Docker host:

```sh
curl -fsSL https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/main/docker/all-in-one/bootstrap.sh | sh
```

The script resolves the latest GitHub release, creates its state below `~/.local/state/zomboid-panel/` by default, generates an updater token, builds the controller, and starts the stack. Set `PANEL_HOME` or `BUILD_ROOT` before running it if you prefer a different host location. It deliberately runs Docker Compose *inside* the controller image, so the host does not need the Docker Compose plugin.

The default URL is `http://localhost:3001`. Before accessing the panel from another machine or through a reverse proxy, update `CORS_ORIGINS` in the generated `.env` file to the exact browser origin, then rerun the final command from the script.

The stack uses Docker named volumes for panel state, logs, the PZ installation, and Zomboid save data. This keeps a default install independent of a particular NAS or host filesystem layout.

The update controller has Docker socket access, but it is not exposed on a host port. The panel can reach it only over the Compose network using the token in `.env`.

## Updating

After the first installation, the panel Settings page can apply a newer GitHub release. The action saves and stops Project Zomboid through RCON, downloads the tagged source, rebuilds the panel image, recreates only the panel service, and waits for its health check. A failed rollout restores the previous source and image.
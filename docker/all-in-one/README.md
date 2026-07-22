# All-in-One Docker Deployment

This deployment runs the panel, SteamCMD, and the Project Zomboid dedicated server in one container. It is for hosts that need process control and PanelBridge file IPC, such as the Tower deployment.

## First install

Run this on the Docker host:

```sh
curl -fsSL https://raw.githubusercontent.com/fpsacha/zomboid-control-panel/v1.0.75/docker/all-in-one/bootstrap.sh | sh
```

The script downloads the tagged source, creates `/mnt/cache/appdata/zomboid-panel/build/ctx/.env` with a generated updater token, builds the controller, and starts the stack. It deliberately runs Docker Compose *inside* the controller image, so the host does not need the Docker Compose plugin.

Before exposing the panel outside `http://zomboid.tower`, update `CORS_ORIGINS` in the generated `.env` file and rerun the final command from the script.

The update controller has Docker socket access, but it is not exposed on a host port. The panel can reach it only over the Compose network using the token in `.env`.

## Updating

After the first installation, the panel Settings page can apply a newer GitHub release. The action saves and stops Project Zomboid through RCON, downloads the tagged source, rebuilds the panel image, recreates only the panel service, and waits for its health check. A failed rollout restores the previous source and image.
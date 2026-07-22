# All-in-One Docker Deployment

This deployment runs the panel, SteamCMD, and the Project Zomboid dedicated server in one container. It is for hosts that need process control and PanelBridge file IPC, such as the Tower deployment.

## First install

1. Copy this folder to `/mnt/cache/appdata/zomboid-panel/build/ctx`.
2. Download or clone a tagged panel source release into `/mnt/cache/appdata/zomboid-panel/build/source`.
3. Copy `.env.example` to `.env` and replace `PANEL_DOCKER_UPDATER_TOKEN` with a long random value.
4. Run `docker compose --env-file .env -f docker-compose.yml up -d --build` from the `ctx` folder.

The update controller has Docker socket access, but it is not exposed on a host port. The panel can reach it only over the Compose network using the token in `.env`.

## Updating

After the first installation, the panel Settings page can apply a newer GitHub release. The action saves and stops Project Zomboid through RCON, downloads the tagged source, rebuilds the panel image, recreates only the panel service, and waits for its health check. A failed rollout restores the previous source and image.
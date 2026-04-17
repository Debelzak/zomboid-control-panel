import esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const distDir = './dist-exe';
const releaseDir = './release';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanDir(dir, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
      }
      return true;
    } catch (error) {
      if (i === maxRetries - 1) {
        console.warn(`Could not fully clean ${dir}: ${error.message}`);
        console.warn('Attempting to continue anyway...');
        return false;
      }
      console.log(`Retry ${i + 1}/${maxRetries} for ${dir}...`);
      await delay(2000);
    }
  }
  return false;
}

function resolveTargets(args) {
  const wantsAll = args.includes('--all');
  const wantsWindows = args.includes('--windows');
  const wantsLinux = args.includes('--linux');

  if (wantsAll || (wantsWindows && wantsLinux)) {
    return ['win', 'linux'];
  }

  if (wantsWindows) {
    return ['win'];
  }

  if (wantsLinux) {
    return ['linux'];
  }

  return [process.platform === 'win32' ? 'win' : 'linux'];
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveBuiltBinaryPath(target) {
  const candidates = target === 'linux'
    ? [
        './dist-exe/zomboid-control-panel',
        './dist-exe/zomboid-control-panel-linux',
      ]
    : [
        './dist-exe/zomboid-control-panel.exe',
        './dist-exe/zomboid-control-panel-win.exe',
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function writeReleaseReadme() {
  const readme = `# Zomboid Control Panel

## Quick Start

### Windows
1. Extract ZomboidControlPanel-windows.zip
2. Run Start.bat (or double-click ZomboidControlPanel.exe)
3. Open your browser to http://localhost:3001
4. Configure your server paths in Settings

### Linux (Ubuntu / Debian)
1. Extract: tar xzf ZomboidControlPanel-linux.tar.gz
   (Execute permissions are preserved in the archive)
2. Run: ./start.sh  (or ./ZomboidControlPanel directly)
3. Open your browser to http://localhost:3001
4. Configure your server paths in Settings

## Linux Troubleshooting
- If you see "Permission denied": chmod +x ZomboidControlPanel start.sh
- If launch fails with glibc errors: requires glibc 2.28+ (CentOS Stream 8+, Rocky 8+, Ubuntu 20.04+).
  CentOS 7 is NOT supported (glibc 2.17 is too old). Use Docker instead.
- The binary is self-contained — Node.js is NOT required.

## CentOS / RHEL Notes
- Open firewall: sudo firewall-cmd --permanent --add-port=3001/tcp && sudo firewall-cmd --reload
- SELinux: If blocked, run: sudo semanage fcontext -a -t admin_home_t "/opt/zomboid-panel(/.*)?" && sudo restorecon -Rv /opt/zomboid-panel
- SteamCMD requires 32-bit libs: sudo yum install glibc.i686 libstdc++.i686
- Increase inotify limit: sudo sysctl -w fs.inotify.max_user_watches=524288
  (make permanent: echo 'fs.inotify.max_user_watches=524288' | sudo tee -a /etc/sysctl.conf)

## Running as a Service (Linux)
A systemd unit file is included:
  sudo useradd -r -m -s /bin/false pzuser      # Create dedicated user (if needed)
  sudo mkdir -p /opt/zomboid-panel
  sudo cp -r ./* /opt/zomboid-panel/
  sudo chown -R pzuser:pzuser /opt/zomboid-panel
  sudo cp zomboid-panel.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now zomboid-panel
Edit the service file to match your install path and user.
See the service file comments for SELinux and firewall setup.

## Docker
  docker compose up -d
See docker-compose.yml comments for volume mount and UID configuration.

## Folder Structure
- ZomboidControlPanel.exe - Windows standalone binary
- ZomboidControlPanel      - Linux standalone binary
- Start.bat                - Windows launch script
- start.sh                 - Linux launch script
- zomboid-panel.service    - systemd unit file (Linux)
- client/dist/             - Web interface (required, must stay alongside binary)
- data/db.json             - Configuration database (created on first run)
- logs/                    - Application logs
- pz-mod/                  - PanelBridge server-side Lua (drop into Install/media/lua/server)
- checksums.txt            - SHA256 hashes for release archives
- release-manifest.json    - Build metadata for this package

## Panel Bridge Setup (Optional)
The PanelBridge Lua enables advanced features like weather control. It is a
server-side drop-in, NOT a Workshop mod — there is no client component.
1. Copy pz-mod/PanelBridge/media/lua/server/PanelBridge.lua into your PZ
   dedicated server's install folder: Install/media/lua/server/PanelBridge.lua
2. Restart your PZ server (no .ini changes needed; nothing loads on clients)
3. Go to Settings in the panel and configure the Panel Bridge section

## Notes
- Keep all files in the same folder structure — the binary needs client/dist/.
- The app runs on port 3001 by default.
- First run: go to Settings to configure your PZ server path.
`;

  fs.writeFileSync('./release/README.txt', readme);
}

async function main() {
  const args = process.argv.slice(2);
  const targets = resolveTargets(args);

  await cleanDir(distDir);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  await cleanDir(releaseDir);
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  console.log('Building client...');
  try {
    execSync('npm run build', { cwd: './client', stdio: 'inherit' });
    console.log('Client built successfully');
  } catch (error) {
    console.error('Client build failed:', error.message);
    process.exit(1);
  }

  console.log('Building server bundle...');

  const rootPkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
  const panelVersion = rootPkg.version || '0.0.0';
  console.log(`Version: ${panelVersion}`);

  await esbuild.build({
    entryPoints: ['./server/index.js'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: './dist-exe/server.cjs',
    external: ['@aws-sdk/client-s3'],
    define: {
      'import.meta.url': 'import_meta_url',
      PANEL_VERSION: JSON.stringify(panelVersion),
    },
    banner: {
      js: "const import_meta_url = require('url').pathToFileURL(__filename).href;",
    },
  });

  console.log('Server bundled successfully');

  const pkgConfig = {
    name: 'zomboid-control-panel',
    version: panelVersion,
    bin: 'server.cjs',
    pkg: {
      scripts: 'server.cjs',
      targets: targets.map((target) => `node18-${target}-x64`),
      outputPath: '.',
    },
  };

  fs.writeFileSync('./dist-exe/package.json', JSON.stringify(pkgConfig, null, 2));

  console.log(`Creating executables for: ${targets.join(', ')}`);
  try {
    execSync('npx pkg . --compress GZip', {
      cwd: distDir,
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('Failed to create executable(s):', error.message);
    process.exit(1);
  }

  const builtArtifacts = [];
  for (const target of targets) {
    const sourceBinary = resolveBuiltBinaryPath(target);
    const targetBinary = target === 'linux'
      ? './release/ZomboidControlPanel'
      : './release/ZomboidControlPanel.exe';

    if (!sourceBinary) {
      console.error(`Missing build output for target: ${target}`);
      process.exit(1);
    }

    fs.copyFileSync(sourceBinary, targetBinary);
    if (target === 'linux') {
      fs.chmodSync(targetBinary, 0o755);
    }

    builtArtifacts.push({
      platform: target,
      fileName: path.basename(targetBinary),
      absolutePath: path.resolve(targetBinary),
    });
  }

  console.log('Creating release package...');

  const clientDist = './client/dist';
  const targetClientDist = './release/client/dist';
  if (fs.existsSync(clientDist)) {
    fs.cpSync(clientDist, targetClientDist, { recursive: true });
  } else {
    console.error('Client dist not found. Run "npm run build" in client first.');
    process.exit(1);
  }

  fs.mkdirSync('./release/data', { recursive: true });
  const releaseDbPath = './release/data/db.json';
  if (!fs.existsSync(releaseDbPath)) {
    const defaultDb = {
      settings: {
        serverPath: '',
        serverExe: '',
        rconPassword: '',
        rconPort: 27015,
        adminPassword: '',
      },
      players: [],
      scheduledTasks: [],
      servers: [],
      discord: {
        enabled: false,
        token: '',
        guildId: '',
        channelId: '',
        adminRoleId: '',
      },
    };
    fs.writeFileSync(releaseDbPath, JSON.stringify(defaultDb, null, 2));
  }

  fs.mkdirSync('./release/logs', { recursive: true });
  fs.writeFileSync('./release/logs/.gitkeep', '');

  if (fs.existsSync('./pz-mod')) {
    fs.cpSync('./pz-mod', './release/pz-mod', { recursive: true });
  }

  // Ship the sql.js WASM blob next to the executable. vehiclesDb.js loads it
  // at runtime to delete rows from the save's vehicles.db. The file is tiny
  // (~660 KB) and pkg can't introspect sql.js's dynamic require, so we copy
  // it manually.
  const wasmSrc = './node_modules/sql.js/dist/sql-wasm.wasm';
  if (fs.existsSync(wasmSrc)) {
    fs.copyFileSync(wasmSrc, './release/sql-wasm.wasm');
  } else {
    console.warn('sql-wasm.wasm not found in node_modules/sql.js/dist — vehicle cleanup will fail at runtime. Run `npm install` first.');
  }

  if (fs.existsSync('./zomboid-panel.service')) {
    fs.copyFileSync('./zomboid-panel.service', './release/zomboid-panel.service');
  }

  const startBat = `@echo off
echo Starting Zomboid Control Panel...
echo.
echo Open your browser to: http://localhost:3001
echo.
if exist ZomboidControlPanel.exe (
  ZomboidControlPanel.exe
) else (
  echo ERROR: ZomboidControlPanel.exe not found in this folder.
)
pause
`;
  fs.writeFileSync('./release/Start.bat', startBat);

  const startSh = `#!/bin/bash
# Zomboid Control Panel — Linux launcher
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting Zomboid Control Panel..."
echo ""
echo "Open your browser to: http://localhost:3001"
echo ""

if [ ! -f "./ZomboidControlPanel" ]; then
  echo "ERROR: ./ZomboidControlPanel was not found in this folder."
  exit 1
fi

# Check glibc version (panel requires glibc 2.28+)
if command -v ldd >/dev/null 2>&1; then
  GLIBC_VER=$(ldd --version 2>&1 | head -1 | grep -oP '\\d+\\.\\d+$' || true)
  if [ -n "$GLIBC_VER" ]; then
    MAJOR=$(echo "$GLIBC_VER" | cut -d. -f1)
    MINOR=$(echo "$GLIBC_VER" | cut -d. -f2)
    if [ "$MAJOR" -lt 2 ] || { [ "$MAJOR" -eq 2 ] && [ "$MINOR" -lt 28 ]; }; then
      echo "WARNING: glibc $GLIBC_VER detected. This binary requires glibc 2.28+."
      echo "CentOS 7 (glibc 2.17) is not supported. Use CentOS Stream 8+, Rocky 8+, or Docker."
    fi
  fi
fi

# Warn if running as root
if [ "$(id -u)" = "0" ]; then
  echo "WARNING: Running as root is not recommended. Consider creating a dedicated user."
fi

./ZomboidControlPanel
`;
  fs.writeFileSync('./release/start.sh', startSh.replace(/\r\n/g, '\n'), { mode: 0o755 });

  const checksumLines = [];
  const manifestArtifacts = [];
  for (const artifact of builtArtifacts) {
    const checksum = sha256File(artifact.absolutePath);
    checksumLines.push(`${checksum}  ${artifact.fileName}`);
    manifestArtifacts.push({
      platform: artifact.platform,
      file: artifact.fileName,
      sha256: checksum,
    });
  }

  fs.writeFileSync('./release/checksums.txt', `${checksumLines.join('\n')}\n`);
  fs.writeFileSync('./release/release-manifest.json', JSON.stringify({
    version: panelVersion,
    builtAt: new Date().toISOString(),
    hostPlatform: process.platform,
    targets,
    artifacts: manifestArtifacts,
  }, null, 2));

  writeReleaseReadme();

  console.log('Release package created successfully');
  console.log('Location: ./release/');
  console.log('Contents:');
  for (const artifact of builtArtifacts) {
    console.log(`  - ${artifact.fileName} (${artifact.platform})`);
  }
  console.log('  - Start.bat');
  console.log('  - start.sh');
  console.log('  - checksums.txt');
  console.log('  - release-manifest.json');
  console.log('  - client/dist/');
  console.log('  - data/');
  console.log('  - logs/');
  console.log('  - pz-mod/');
  if (fs.existsSync('./release/zomboid-panel.service')) {
    console.log('  - zomboid-panel.service');
  }
  console.log('  - README.txt');
}

await main();

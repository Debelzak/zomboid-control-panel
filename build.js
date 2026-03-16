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
1. Run Start.bat (or double-click ZomboidControlPanel.exe)
2. Open your browser to http://localhost:3001
3. Configure your server paths in Settings

### Linux (Ubuntu)
1. chmod +x start.sh ZomboidControlPanel
2. ./start.sh (or ./ZomboidControlPanel)
3. Open your browser to http://localhost:3001
4. Configure your server paths in Settings

## Linux Troubleshooting
- If launch fails with "Permission denied", run: chmod +x ZomboidControlPanel start.sh
- If launch fails with missing runtime or glibc errors, run on a newer distro base or use Docker mode.
- If browser file pickers do not open, install zenity (GNOME) or kdialog (KDE).
- If your startup script fails, confirm the configured Linux script path is executable.

## Folder Structure
- ZomboidControlPanel.exe - Windows standalone binary
- ZomboidControlPanel - Linux standalone binary
- client/dist/ - Web interface files
- data/db.json - Configuration database
- logs/ - Application logs
- pz-mod/ - PanelBridge mod for advanced features
- checksums.txt - SHA256 hashes for release binaries
- release-manifest.json - Build metadata for this package

## Panel Bridge Setup (Optional)
The PanelBridge mod enables advanced features like weather control:
1. Copy the pz-mod/PanelBridge folder to your server's mods folder
2. Add "PanelBridge" to your server's Mods= line in the .ini file
3. Restart your PZ server
4. Go to Settings in the panel and configure the Panel Bridge section

## Notes
- Keep all files in the same folder structure.
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
 echo "Starting Zomboid Control Panel..."
 echo ""
 echo "Open your browser to: http://localhost:3001"
 echo ""
 if [ ! -f "./ZomboidControlPanel" ]; then
   echo "ERROR: ./ZomboidControlPanel was not found in this folder."
   exit 1
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
  console.log('  - README.txt');
}

await main();

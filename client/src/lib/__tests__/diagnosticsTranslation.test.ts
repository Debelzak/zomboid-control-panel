import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { translateDiagnosticCheck } from '../diagnosticsTranslation'

describe('translateDiagnosticCheck', () => {
  beforeEach(() => {
    void i18n.changeLanguage('fr')
  })

  afterEach(() => {
    void i18n.changeLanguage('en')
  })

  it('translates a check with no interpolation needed', () => {
    const check = {
      id: 'server.process',
      status: 'ok',
      label: 'Server process running',
      message: 'Project Zomboid dedicated server is alive.',
    }
    expect(translateDiagnosticCheck(check)).toEqual({
      label: 'Processus du serveur en cours d\'exécution',
      message: 'Le serveur dédié Project Zomboid est actif.',
      hint: undefined,
    })
  })

  it('translates label, message and hint together', () => {
    const check = {
      id: 'server.process',
      status: 'warn',
      label: 'Server process',
      message: 'Server is stopped. Start it from the dashboard.',
      hint: 'Dashboard → Start Server',
    }
    const translated = translateDiagnosticCheck(check)
    expect(translated.label).toBe('Processus du serveur')
    expect(translated.message).toBe('Le serveur est arrêté. Démarrez-le depuis le tableau de bord.')
    expect(translated.hint).toBe('Tableau de bord → Démarrer le serveur')
  })

  it('interpolates params into the translated message', () => {
    const check = {
      id: 'rcon.connected',
      status: 'ok',
      label: 'RCON connected',
      message: 'Connected to 10.0.0.5:27015.',
      params: { host: '10.0.0.5', port: 27015 },
    }
    expect(translateDiagnosticCheck(check).message).toBe('Connecté à 10.0.0.5:27015.')
  })

  it('falls back to the server English text when params are missing', () => {
    const check = {
      id: 'rcon.connected',
      status: 'ok',
      label: 'RCON connected',
      message: 'Connected to 10.0.0.5:27015.',
    }
    expect(translateDiagnosticCheck(check).message).toBe('Connected to 10.0.0.5:27015.')
  })

  it('falls back to the server English text when params are malformed', () => {
    const check = {
      id: 'rcon.connected',
      status: 'ok',
      label: 'RCON connected',
      message: 'Connected to 10.0.0.5:27015.',
      params: { host: '10.0.0.5' }, // missing `port`
    }
    expect(translateDiagnosticCheck(check).message).toBe('Connected to 10.0.0.5:27015.')
  })

  it('falls back untouched for a check id with no registered translation', () => {
    const check = {
      id: 'some.unregistered.check',
      status: 'ok',
      label: 'Some check',
      message: 'Some message.',
      hint: 'Some hint',
    }
    expect(translateDiagnosticCheck(check)).toEqual({
      label: 'Some check',
      message: 'Some message.',
      hint: 'Some hint',
    })
  })

  it('leaves hint undefined when the check has none, even if a translation exists for other statuses', () => {
    const check = {
      id: 'discord.bot',
      status: 'ok',
      label: 'Discord bot connected',
      message: 'Logged in as PanelBot#1234.',
      params: { tag: 'PanelBot#1234' },
    }
    const translated = translateDiagnosticCheck(check)
    expect(translated.message).toBe('Connecté en tant que PanelBot#1234.')
    expect(translated.hint).toBeUndefined()
  })

  it('does not affect English (the source language)', () => {
    void i18n.changeLanguage('en')
    const check = {
      id: 'server.process',
      status: 'ok',
      label: 'Server process running',
      message: 'Project Zomboid dedicated server is alive.',
    }
    expect(translateDiagnosticCheck(check)).toEqual({
      label: 'Server process running',
      message: 'Project Zomboid dedicated server is alive.',
      hint: undefined,
    })
  })

  it('interpolates a name param (server.active)', () => {
    const check = {
      id: 'server.active',
      status: 'ok',
      label: 'Active server',
      message: 'My Zomboid Server.',
      params: { name: 'My Zomboid Server' },
    }
    expect(translateDiagnosticCheck(check).message).toBe('My Zomboid Server.')
  })

  it('resolves the netMount variant to its own label/message/hint, not the plain (missing) entry', () => {
    const check = {
      id: 'server.installPath',
      status: 'fail',
      label: 'Install path not found',
      message: 'Network share or mount not reachable. Check VPN, mount, or share availability.',
      hint: 'Verify the share is mounted and credentials are valid',
      variant: 'netMount',
    }
    const translated = translateDiagnosticCheck(check)
    expect(translated.message).toBe('Partage réseau ou point de montage inaccessible. Vérifiez le VPN, le montage ou la disponibilité du partage.')
    expect(translated.hint).toBe('Vérifiez que le partage est monté et que les identifiants sont valides')
  })

  it('resolves the local variant differently from the netMount variant for the same id+status', () => {
    const check = {
      id: 'server.installPath',
      status: 'fail',
      label: 'Install path not found',
      message: 'Configured install path does not exist or is unreadable.',
      hint: 'Check the path in Servers → Edit',
      variant: 'local',
    }
    const translated = translateDiagnosticCheck(check)
    expect(translated.message).toBe("Le chemin d'installation configuré n'existe pas ou n'est pas lisible.")
    expect(translated.hint).toBe('Vérifiez le chemin dans Serveurs → Modifier')
  })

  it('the plain (non-variant) entry for the same id+status is still independently reachable', () => {
    const check = {
      id: 'server.installPath',
      status: 'fail',
      label: 'Install path missing',
      message: 'Active server has no installPath configured.',
      hint: 'Servers → Edit → Install Path',
      // no variant -- this is the "missing entirely" case
    }
    const translated = translateDiagnosticCheck(check)
    expect(translated.message).toBe("Le serveur actif n'a pas de chemin d'installation configuré.")
  })

  it('combines a variant selection with param interpolation (server.jre)', () => {
    const check = {
      id: 'server.jre',
      status: 'warn',
      label: 'Bundled JRE not found',
      message: 'Could not locate jre64/bin/java under the install path. Server may fail to start unless system Java is on PATH.',
      hint: 'Most installs ship a JRE under jre64/. Re-run SteamCMD if missing.',
      params: { javaBin: 'java' },
      variant: 'linux',
    }
    const translated = translateDiagnosticCheck(check)
    expect(translated.message).toBe('Impossible de localiser jre64/bin/java dans le chemin d\'installation. Le serveur risque de ne pas démarrer sauf si Java système est dans le PATH.')
    expect(translated.hint).toBe('La plupart des installations embarquent un JRE sous jre64/. Relancez SteamCMD s\'il est manquant.')
  })

  it('falls back to the server English text when the variant is missing/unregistered', () => {
    const check = {
      id: 'server.installPath',
      status: 'fail',
      label: 'Install path not found',
      message: 'Some brand new scenario text.',
      variant: 'someFutureVariantNotYetTranslated',
    }
    expect(translateDiagnosticCheck(check).message).toBe('Some brand new scenario text.')
  })

  it('interpolates a relative-path param (server.jre.ok)', () => {
    const check = {
      id: 'server.jre',
      status: 'ok',
      label: 'Bundled JRE present',
      message: 'Found jre64/bin/java.exe.',
      params: { path: 'jre64/bin/java.exe' },
    }
    expect(translateDiagnosticCheck(check).message).toBe('jre64/bin/java.exe trouvé.')
  })

  it('db.writable.ok interpolates count and size params', () => {
    const check = {
      id: 'db.writable',
      status: 'ok',
      label: 'Database accessible',
      message: '7 collections, 4 MB.',
      params: { count: 7, size: '4 MB' },
    }
    expect(translateDiagnosticCheck(check).message).toBe('7 collections, 4 MB.')
  })

  it('resolves 4 distinct variants for the same id+status (db.backup warn)', () => {
    const unreadable = translateDiagnosticCheck({
      id: 'db.backup',
      status: 'warn',
      label: 'Backup status unknown',
      message: 'Could not read the backup directory (timeout or permission denied).',
      variant: 'unreadable',
    })
    const none = translateDiagnosticCheck({
      id: 'db.backup',
      status: 'warn',
      label: 'No database backups',
      message: 'No db.json backups found. Manual backup recommended before risky changes.',
      hint: 'Debug → Database → Create Backup',
      variant: 'none',
    })
    const old = translateDiagnosticCheck({
      id: 'db.backup',
      status: 'warn',
      label: 'Database backup old',
      message: 'Newest backup 3d ago. Consider creating a fresh one.',
      hint: 'Debug → Database → Create Backup',
      params: { age: '3d ago' },
      variant: 'old',
    })
    const error = translateDiagnosticCheck({
      id: 'db.backup',
      status: 'warn',
      label: 'Backup status unknown',
      message: 'Could not inspect backups: disk full',
      params: { reason: 'disk full' },
      variant: 'error',
    })

    expect(unreadable.message).toBe('Impossible de lire le dossier de sauvegarde (délai dépassé ou permission refusée).')
    expect(none.message).toBe('Aucune sauvegarde de db.json trouvée. Une sauvegarde manuelle est recommandée avant des changements risqués.')
    expect(old.message).toBe('Dernière sauvegarde 3d ago. Envisagez d\'en créer une nouvelle.')
    expect(error.message).toBe('Impossible d\'inspecter les sauvegardes : disk full')
    // All four are genuinely distinct -- prove none of them collapsed onto another.
    const messages = [unreadable.message, none.message, old.message, error.message]
    expect(new Set(messages).size).toBe(4)
  })

  it('interpolates an empty-string param without treating it as missing (storage.saveSize, non-truncated)', () => {
    const check = {
      id: 'storage.saveSize',
      status: 'ok',
      label: 'Save folder healthy',
      message: '2 GB across 150 chunks.',
      params: { size: '2 GB', chunks: '150', truncatedSuffix: '' },
    }
    expect(translateDiagnosticCheck(check).message).toBe('2 GB répartis sur 150 chunk(s).')
  })

  it('interpolates a non-empty truncatedSuffix param (storage.saveSize, truncated scan)', () => {
    const check = {
      id: 'storage.saveSize',
      status: 'warn',
      label: 'Save folder very large',
      message: '35 GB across 9,000 chunks (scan truncated). Backups, restores, and chunk cleanups will be slow.',
      params: { size: '35 GB', chunks: '9,000', truncatedSuffix: ' (scan truncated)' },
    }
    expect(translateDiagnosticCheck(check).message).toBe(
      '35 GB répartis sur 9,000 chunk(s) (scan truncated). Les sauvegardes, restaurations et nettoyages de chunks seront lents.',
    )
  })

  it('disk.free interpolates free/total params identically across ok/warn/fail statuses', () => {
    const fail = translateDiagnosticCheck({
      id: 'disk.free',
      status: 'fail',
      label: 'Disk almost full',
      message: 'Only 300 MB free of 500 GB on data drive.',
      params: { free: '300 MB', total: '500 GB' },
    })
    const ok = translateDiagnosticCheck({
      id: 'disk.free',
      status: 'ok',
      label: 'Disk space healthy',
      message: '50 GB free of 500 GB.',
      params: { free: '50 GB', total: '500 GB' },
    })
    expect(fail.message).toBe('Seulement 300 MB libres sur 500 GB sur le disque de données.')
    expect(ok.message).toBe('50 GB libres sur 500 GB.')
  })
})

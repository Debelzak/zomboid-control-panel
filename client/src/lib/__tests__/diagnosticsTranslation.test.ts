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
})

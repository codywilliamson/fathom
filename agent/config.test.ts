import { describe, expect, test } from 'bun:test'
import { loadConfig } from './config'

describe('loadConfig', () => {
  test('throws without FATHOM_SERVER', () => {
    expect(() => loadConfig({})).toThrow(/FATHOM_SERVER/)
  })

  test('trims a trailing slash off the server url', () => {
    const config = loadConfig({ FATHOM_SERVER: 'http://laptop:4950/' })
    expect(config.server).toBe('http://laptop:4950')
  })

  test('defaults machine to os.hostname() when unset', () => {
    const config = loadConfig({ FATHOM_SERVER: 'http://laptop:4950' })
    expect(config.machine).toBeTruthy()
  })

  test('FATHOM_MACHINE overrides the hostname default', () => {
    const config = loadConfig({ FATHOM_SERVER: 'http://laptop:4950', FATHOM_MACHINE: 'desktop-win' })
    expect(config.machine).toBe('desktop-win')
  })

  test('token is undefined when unset', () => {
    const config = loadConfig({ FATHOM_SERVER: 'http://laptop:4950' })
    expect(config.token).toBeUndefined()
  })

  test('token is passed through when set', () => {
    const config = loadConfig({ FATHOM_SERVER: 'http://laptop:4950', FATHOM_INGEST_TOKEN: 'secret' })
    expect(config.token).toBe('secret')
  })

  test('cursor file falls back to LOCALAPPDATA on windows-shaped env', () => {
    const config = loadConfig({ FATHOM_SERVER: 'http://laptop:4950', LOCALAPPDATA: 'C:\\Users\\cody\\AppData\\Local' })
    expect(config.cursorFile).toContain('fathom')
    expect(config.cursorFile).toContain('cursors.json')
  })

  test('FATHOM_CURSOR_FILE overrides the default location', () => {
    const config = loadConfig({ FATHOM_SERVER: 'http://laptop:4950', FATHOM_CURSOR_FILE: '/tmp/custom.json' })
    expect(config.cursorFile).toBe('/tmp/custom.json')
  })
})

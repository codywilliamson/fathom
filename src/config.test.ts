import { describe, expect, test } from 'bun:test'
import { config } from './config'

// starter test — keeps `bun test` green until real tests land
describe('config', () => {
  test('defaults are sane', () => {
    expect(config.host).toBe('0.0.0.0')
    expect(Number.isFinite(config.port)).toBe(true)
    expect(Array.isArray(config.allowedHosts)).toBe(true)
  })
})

import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptToken, encryptToken, parseEncryptionKey } from '../src/crypto'

const key = randomBytes(32)

describe('token encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptToken('IGAAT-secret-token', key)
    const b = encryptToken('IGAAT-secret-token', key)
    expect(a).not.toBe(b)
    expect(a.startsWith('v1:')).toBe(true)
    expect(a).not.toContain('IGAAT')
    expect(decryptToken(a, key)).toBe('IGAAT-secret-token')
  })

  it('rejects tampered ciphertext and the wrong key', () => {
    const value = encryptToken('token', key)
    const [v, iv, tag, ct] = value.split(':')
    const tampered = [v, iv, tag, Buffer.from('nope').toString('base64')].join(':')
    expect(() => decryptToken(tampered, key)).toThrow()
    expect(() => decryptToken(value, randomBytes(32))).toThrow()
    expect(ct).toBeTruthy()
  })

  it('rejects unknown formats', () => {
    expect(() => decryptToken('plain-token', key)).toThrow(/format/)
  })

  it('parses a base64 32-byte key and rejects others', () => {
    expect(parseEncryptionKey(key.toString('base64')).equals(key)).toBe(true)
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
  })
})

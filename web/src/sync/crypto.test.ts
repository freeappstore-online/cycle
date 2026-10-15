import { describe, expect, it } from 'vitest'
import {
  KDF_ITERATIONS,
  WrongPassphraseError,
  decrypt,
  deriveKey,
  encrypt,
  fromBase64,
  makeKeyCheck,
  newKdfParams,
  openJSON,
  sealJSON,
  toBase64,
  verifyKeyCheck,
} from './crypto'

// Fewer iterations keep the suite fast; the production default is checked separately.
const params = newKdfParams(1000)
const text = new TextEncoder()

describe('key derivation', () => {
  it('defaults to PBKDF2-SHA-256 × 600,000 with a 16-byte random salt', () => {
    const p = newKdfParams()
    expect(p).toMatchObject({ v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iter: KDF_ITERATIONS })
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000)
    expect(fromBase64(p.salt)).toHaveLength(16)
    expect(newKdfParams().salt).not.toBe(p.salt)
  })

  it('derives a non-extractable AES-256-GCM key', async () => {
    const key = await deriveKey('correct horse battery staple', params)
    expect(key.extractable).toBe(false)
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
  })

  it('refuses unknown formats', async () => {
    await expect(deriveKey('x', { ...params, kdf: 'scrypt' as never })).rejects.toThrow(/Update the app/)
  })
})

describe('encrypt / decrypt', () => {
  it('round-trips JSON through gzip + AES-GCM', async () => {
    const key = await deriveKey('pass phrase', params)
    const value = { days: [{ date: '2026-03-01', symptoms: ['cramps'], note: 'ünïcødé ✎' }], n: 1 }
    const sealed = await sealJSON(key, value, 'cycle:y2026')
    expect(sealed).not.toContain('2026-03-01')
    expect(await openJSON(key, sealed, 'cycle:y2026')).toEqual(value)
  })

  it('uses a fresh IV every time', async () => {
    const key = await deriveKey('pass phrase', params)
    const a = fromBase64(await encrypt(key, text.encode('same'), 'l'))
    const b = fromBase64(await encrypt(key, text.encode('same'), 'l'))
    expect(toBase64(a.subarray(0, 12))).not.toBe(toBase64(b.subarray(0, 12)))
    expect(toBase64(a)).not.toBe(toBase64(b))
  })

  it('rejects a wrong passphrase', async () => {
    const right = await deriveKey('right passphrase', params)
    const wrong = await deriveKey('wrong passphrase', params)
    const check = await makeKeyCheck(right)
    await expect(verifyKeyCheck(right, check)).resolves.toBeUndefined()
    await expect(verifyKeyCheck(wrong, check)).rejects.toBeInstanceOf(WrongPassphraseError)
    const sealed = await sealJSON(right, { a: 1 }, 'cycle:y2026')
    await expect(openJSON(wrong, sealed, 'cycle:y2026')).rejects.toThrow()
  })

  it('rejects tampered ciphertext (GCM authentication)', async () => {
    const key = await deriveKey('pass phrase', params)
    const sealed = fromBase64(await sealJSON(key, { a: 1 }, 'cycle:y2026'))
    for (const i of [0, 13, sealed.length - 1]) {
      const tampered = new Uint8Array(sealed)
      tampered[i] ^= 0x01
      await expect(decrypt(key, toBase64(tampered), 'cycle:y2026')).rejects.toThrow()
    }
  })

  it('binds a blob to its key name', async () => {
    const key = await deriveKey('pass phrase', params)
    const sealed = await sealJSON(key, { a: 1 }, 'cycle:y2026')
    await expect(openJSON(key, sealed, 'cycle:y2025')).rejects.toThrow()
  })
})

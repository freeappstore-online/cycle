// Client-side encryption for sync. WebCrypto only, no third-party code.
//
// A passphrase is stretched with PBKDF2-SHA-256 into a non-extractable
// AES-256-GCM key. Every blob is gzipped (CompressionStream), then encrypted
// with a fresh 12-byte IV, and stored as base64(iv ‖ ciphertext). Each blob is
// bound to its KV key through GCM's additional data, so blobs can't be swapped
// between keys without failing authentication. The passphrase itself is never
// stored or sent anywhere.

type Bytes = Uint8Array<ArrayBuffer>

export const KDF_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12
/** Encrypted under the key and stored in plaintext metadata, to detect a wrong passphrase before writing anything. */
const KEY_CHECK = 'cycle-key-check-v1'

/** Plaintext key-derivation metadata stored alongside the ciphertext. */
export interface KdfParams {
  v: 1
  alg: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA-256'
  iter: number
  /** base64, 16 random bytes. */
  salt: string
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("That passphrase doesn't match the one used for your synced data.")
    this.name = 'WrongPassphraseError'
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function fromBase64(b64: string): Bytes {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function newKdfParams(iter = KDF_ITERATIONS): KdfParams {
  return { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iter, salt: toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES))) }
}

export async function deriveKey(passphrase: string, params: KdfParams): Promise<CryptoKey> {
  if (params.v !== 1 || params.alg !== 'AES-256-GCM' || params.kdf !== 'PBKDF2-SHA-256') {
    throw new Error('Synced data uses an encryption format this version of Cycle does not know. Update the app.')
  }
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(params.salt), iterations: params.iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function pipe(bytes: Bytes, transform: CompressionStream | DecompressionStream): Promise<Bytes> {
  const input = new ReadableStream<Bytes>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const reader = input.pipeThrough(transform).getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.length
  }
  const out = new Uint8Array(length)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export const gzip = (bytes: Bytes) => pipe(bytes, new CompressionStream('gzip'))
export const gunzip = (bytes: Bytes) => pipe(bytes, new DecompressionStream('gzip'))

/** base64(iv ‖ AES-GCM(plain)), authenticated together with `label`. */
export async function encrypt(key: CryptoKey, plain: Bytes, label: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(label) }, key, plain),
  )
  const out = new Uint8Array(IV_BYTES + ct.length)
  out.set(iv)
  out.set(ct, IV_BYTES)
  return toBase64(out)
}

/** Throws (OperationError) if the key, label or ciphertext don't match. */
export async function decrypt(key: CryptoKey, envelope: string, label: string): Promise<Bytes> {
  const bytes = fromBase64(envelope)
  if (bytes.length <= IV_BYTES) throw new Error('Ciphertext is too short')
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: encoder.encode(label) },
    key,
    bytes.subarray(IV_BYTES),
  )
  return new Uint8Array(plain)
}

/** JSON → gzip → encrypt. */
export async function sealJSON(key: CryptoKey, value: unknown, label: string): Promise<string> {
  return encrypt(key, await gzip(encoder.encode(JSON.stringify(value))), label)
}

/** decrypt → gunzip → JSON. */
export async function openJSON<T = unknown>(key: CryptoKey, envelope: string, label: string): Promise<T> {
  return JSON.parse(decoder.decode(await gunzip(await decrypt(key, envelope, label)))) as T
}

export function makeKeyCheck(key: CryptoKey): Promise<string> {
  return encrypt(key, encoder.encode(KEY_CHECK), 'cycle:check')
}

/** Resolves if `key` decrypts the key check; throws WrongPassphraseError otherwise. */
export async function verifyKeyCheck(key: CryptoKey, check: string): Promise<void> {
  let plain: Bytes
  try {
    plain = await decrypt(key, check, 'cycle:check')
  } catch {
    throw new WrongPassphraseError()
  }
  if (decoder.decode(plain) !== KEY_CHECK) throw new WrongPassphraseError()
}

/** Hex SHA-256 of a string; used locally to tell whether a year changed. */
export async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

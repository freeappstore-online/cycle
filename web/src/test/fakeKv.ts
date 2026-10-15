import type { KvLike } from '../sync/engine'

/** fas.kv stand-in: values are stored as JSON text, like the real API. */
export class FakeKv implements KvLike {
  readonly data = new Map<string, string>()
  readonly sent: string[] = []
  online = true
  private check() {
    if (!this.online) throw new TypeError('Failed to fetch')
  }
  async get<T>(key: string): Promise<T | null> {
    this.check()
    const v = this.data.get(key)
    return v === undefined ? null : (JSON.parse(v) as T)
  }
  async set(key: string, value: unknown) {
    this.check()
    const body = JSON.stringify(value)
    this.sent.push(body)
    this.data.set(key, body)
  }
  async delete(key: string) {
    this.check()
    this.data.delete(key)
  }
  async list({ prefix = '' } = {}) {
    this.check()
    return [...this.data.keys()].filter((k) => k.startsWith(prefix))
  }
}

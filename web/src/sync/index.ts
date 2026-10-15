import { useSyncExternalStore } from 'react'
import { cycleRepo } from '../data/repository'
import { fas } from '../fas'
import { SyncEngine, type SyncStatus, idbSyncStateStore } from './engine'

export { SyncEngine, type SyncStatus } from './engine'
export { WrongPassphraseError } from './crypto'

/** The app-wide sync engine. Does nothing until the user turns sync on. */
export const syncEngine = new SyncEngine({ repo: cycleRepo, kv: fas.kv, auth: fas.auth, store: idbSyncStateStore() })

export function useSyncStatus(engine: SyncEngine = syncEngine): SyncStatus {
  return useSyncExternalStore(engine.subscribe, engine.status)
}

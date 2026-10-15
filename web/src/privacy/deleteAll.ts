// "Delete all data": wipes everything Cycle stores on this device and, when
// signed in, every cycle:* key in fas.kv (the encrypted sync copy).

import type { CycleRepository } from '../data/repository'
import type { SyncEngine } from '../sync/engine'
import { clearOnboardingSeen } from './onboarding'

export class NeedsSignInError extends Error {
  constructor() {
    super('Sync is on, so there is an encrypted copy in your account. Sign in first so it can be deleted too.')
    this.name = 'NeedsSignInError'
  }
}

export async function deleteAllData({
  repo,
  engine,
  signedIn,
}: {
  repo: CycleRepository
  engine: SyncEngine
  signedIn: boolean
}): Promise<void> {
  if (signedIn) {
    // Deletes all cycle:* keys and forgets the sync key and settings on this
    // device, whether or not sync was on here.
    await engine.disable()
  } else if (engine.status().enabled) {
    // Wiping only the device would leave the cloud copy behind (and the next
    // sync would propagate the wipe anyway). Make the user sign in first.
    throw new NeedsSignInError()
  }
  await repo.clearAll()
  clearOnboardingSeen()
}

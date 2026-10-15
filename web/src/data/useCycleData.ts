import { type DependencyList, useEffect, useState } from 'react'
import type { CycleRepository } from './repository'
import { useCycleRepo } from './RepoContext'

/**
 * Loads data from the repository (from CycleRepoContext) and reloads it after
 * every write, so screens stay current. Returns undefined until the first load
 * finishes.
 *
 *   const days = useCycleData((repo) => repo.listDays(month), [month.from, month.to])
 */
export function useCycleData<T>(load: (repo: CycleRepository) => Promise<T>, deps: DependencyList = []): T | undefined {
  const repo = useCycleRepo()
  const [value, setValue] = useState<T>()

  useEffect(() => {
    let cancelled = false
    let run = 0
    const reload = () => {
      const current = ++run
      load(repo).then(
        (v) => {
          if (!cancelled && current === run) setValue(() => v)
        },
        (err: unknown) => console.error('Cycle data load failed', err),
      )
    }
    reload()
    const unsubscribe = repo.subscribe(reload)
    return () => {
      cancelled = true
      unsubscribe()
    }
    // `load` is usually an inline arrow; callers list what it depends on in `deps`.
  }, [repo, ...deps])

  return value
}

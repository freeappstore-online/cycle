import { createContext, useContext } from 'react'
import { type CycleRepository, cycleRepo } from './repository'

/** The repository screens read and write. Tests provide their own. */
export const CycleRepoContext = createContext<CycleRepository>(cycleRepo)

export const useCycleRepo = () => useContext(CycleRepoContext)

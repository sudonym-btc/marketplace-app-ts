import { createContext, useContext, type ReactNode } from 'react'

import { useAppState } from './appState'

type AppStateContextValue = ReturnType<typeof useAppState>

const AppStateContext = createContext<AppStateContextValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const value = useAppState()
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useMarketplaceApp(): AppStateContextValue {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useMarketplaceApp must be used inside AppStateProvider')
  return value
}

import type { ReactNode } from 'react'
import { Navigate } from '@tanstack/react-router'

import { useMarketplaceApp } from '../state/AppStateContext'
import { LoginGate } from './LoginGate'

export function RequireLogin({ children }: { children: ReactNode }) {
  const { state } = useMarketplaceApp()
  if (state.restoringSigner || state.sessionError) return <LoginGate />
  if (!state.session) return <Navigate to="/login" />
  return <>{children}</>
}

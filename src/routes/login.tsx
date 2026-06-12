import { Navigate, createFileRoute } from '@tanstack/react-router'

import { LoginGate } from '../components/LoginGate'
import { useMarketplaceApp } from '../state/AppStateContext'

function LoginRoute() {
  const { state } = useMarketplaceApp()
  if (state.session && !state.restoringSigner) return <Navigate to="/" />
  return <LoginGate />
}

export const Route = createFileRoute('/login')({
  component: LoginRoute,
})

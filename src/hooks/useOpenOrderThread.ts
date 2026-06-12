import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import type * as marketplace from 'nostr-tools/marketplace'

import { useMarketplaceApp } from '../state/AppStateContext'

function buyerPeerPubkey(group: marketplace.ParsedOrderGroup): string | undefined {
  return group.buyerOrder?.event.pubkey ?? group.participants.find(participant => participant.role === 'buyer')?.pubkey
}

export function useOpenOrderThread() {
  const navigate = useNavigate()
  const { state, actions } = useMarketplaceApp()
  const session = state.session
  const marketplaceSession = state.marketplace?.runtime

  return useCallback(async (group: marketplace.ParsedOrderGroup, peerRole: 'buyer' | 'seller') => {
    if (!session) {
      actions.setError('Sign in to open order threads')
      await navigate({ to: '/login' })
      return
    }
    let peerPubkey = peerRole === 'seller' ? group.sellerPubkey : buyerPeerPubkey(group)
    if (peerRole === 'buyer' && marketplaceSession) {
      try {
        const resolved = await marketplaceSession.orders.groups.resolveParticipants(group, {
          signer: session.signer,
          signerPubkey: session.pubkey,
        })
        peerPubkey = resolved.participants.find(participant =>
          participant.role === 'buyer' && participant.realPubkey)?.realPubkey ?? peerPubkey
      } catch (err) {
        console.warn('[marketplace-app] unable to resolve buyer participant for order thread', {
          tradeId: group.tradeId,
        }, err)
      }
    }
    if (!peerPubkey) {
      actions.setError('No order participant found for this thread')
      return
    }
    const participants = [session.pubkey, peerPubkey].sort((a, b) => a.localeCompare(b))
    console.debug('[marketplace-app] opening order thread from orders page', {
      tradeId: group.tradeId,
      peerRole,
      peerPubkey,
      participantCount: participants.length,
    })
    await navigate({
      to: '/inbox',
      search: {
        conversation: group.tradeId,
        participants: participants.join(','),
      },
    })
  }, [actions, marketplaceSession, navigate, session])
}

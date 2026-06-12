import * as marketplace from 'nostr-tools/marketplace'

import type { AppSession, LoadedMarketplace } from '../types'

function safeUnits(value: string | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n
}

export function bidChainUnits(chain: marketplace.ParsedAuctionBidChain): bigint {
  return safeUnits(chain.amount.value)
}

export function sortBidChains(chains: marketplace.ParsedAuctionBidChain[]): marketplace.ParsedAuctionBidChain[] {
  return [...chains].sort((left, right) => {
    const rightValue = bidChainUnits(right)
    const leftValue = bidChainUnits(left)
    if (rightValue !== leftValue) return rightValue > leftValue ? 1 : -1
    return right.head.bid.event.created_at - left.head.bid.event.created_at
  })
}

function completeWinningBidId(complete: marketplace.ParsedMarketplaceAuctionComplete | undefined): string | undefined {
  const data = complete?.content.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const winningBidId = (data as Record<string, unknown>).winningBidId
    if (typeof winningBidId === 'string' && winningBidId.length > 0) return winningBidId
  }
  return complete?.winningBidId
}

export function isWinningBidChain(
  chain: marketplace.ParsedAuctionBidChain,
  complete: marketplace.ParsedMarketplaceAuctionComplete | undefined,
): boolean {
  const winner = completeWinningBidId(complete)
  return Boolean(winner && chain.groups.some(group => winner === group.bid.event.id || winner === group.tradeId))
}

export function publicBidBuyerPubkey(group: marketplace.ParsedAuctionBidGroup): string | undefined {
  const proof = group.bid.participantProofs.find(candidate => candidate.role === 'buyer') ?? group.bid.participantProofs[0]
  if (!proof || proof.mode !== 'public') return undefined
  const resolution = marketplace.participantProofs.resolvePublic(proof, {
    listingAnchor: group.bid.listingAnchor,
    tradeId: group.bid.tradeId,
    role: 'buyer',
    participantPubkey: proof.participantPubkey,
  })
  return resolution.status === 'resolved' && resolution.role === 'buyer' ? resolution.realPubkey : undefined
}

export function publicBidChainBuyerPubkey(chain: marketplace.ParsedAuctionBidChain): string | undefined {
  return publicBidBuyerPubkey(chain.head) ?? chain.groups.map(publicBidBuyerPubkey).find(Boolean)
}

function bidGroupBuyerParticipantPubkey(group: marketplace.ParsedAuctionBidGroup): string | undefined {
  return group.participants.find(participant => participant.role === 'buyer')?.pubkey
    ?? group.bid.participants.find(participant => participant.role === 'buyer')?.pubkey
}

export function isOwnBidChain(
  chain: marketplace.ParsedAuctionBidChain,
  sessionPubkey: string | undefined,
  localAuctionBidPubkeys: Set<string>,
): boolean {
  return chain.groups.some(group => {
    const buyerPubkey = bidGroupBuyerParticipantPubkey(group)
    if (localAuctionBidPubkeys.has(group.bid.event.pubkey)) return true
    if (buyerPubkey && localAuctionBidPubkeys.has(buyerPubkey)) return true
    if (group.payments.some(payment =>
      localAuctionBidPubkeys.has(payment.event.pubkey) ||
      payment.participants.some(participant =>
        participant.role === 'buyer' && localAuctionBidPubkeys.has(participant.pubkey),
      ),
    )) return true
    return Boolean(sessionPubkey && publicBidBuyerPubkey(group) === sessionPubkey)
  })
}

export function bidChainStageLabel(
  chain: marketplace.ParsedAuctionBidChain,
  complete: marketplace.ParsedMarketplaceAuctionComplete | undefined,
): string {
  if (chain.groups.some(group => group.settlement?.content.action === 'auction_promote')) return 'Promoted to order'
  if (chain.groups.every(group => group.settlement?.content.action === 'auction_refund')) return 'Refunded'
  if (complete && isWinningBidChain(chain, complete)) return 'Selected winner'
  if (complete) return 'Outbid'
  if (!chain.complete) return 'Missing prior bid'
  if (chain.groups.some(group => group.paymentNack)) return 'Arbiter rejected'
  if (chain.groups.every(group => group.paymentAck)) return 'Arbiter accepted'
  if (chain.groups.some(group => group.payment)) return 'Funded, awaiting arbiter'
  return 'Bid sent'
}

export function bidChainStageClass(
  chain: marketplace.ParsedAuctionBidChain,
  complete: marketplace.ParsedMarketplaceAuctionComplete | undefined,
): string {
  if (chain.groups.some(group => group.settlement?.content.action === 'auction_promote') || (complete && isWinningBidChain(chain, complete))) {
    return 'commit'
  }
  if (!chain.complete || chain.groups.some(group => group.paymentNack)) return 'cancel'
  return ''
}

export async function deriveLocalAuctionBidPubkeys(
  session: AppSession | undefined,
  marketplaceState: LoadedMarketplace | undefined,
): Promise<Set<string>> {
  const marketplaceSession = marketplaceState?.runtime
  if (!session || !marketplaceState || !marketplaceSession) return new Set()

  const seedEvent = marketplaceSession.seed.event ?? (await marketplaceSession.seed.ensureCreated()).event
  const payload = marketplace.seed.parsePayload(await session.signer.nip44Decrypt(session.pubkey, seedEvent.content))
  const limit = Math.max(500, marketplaceState.nextTradeIndex + 32)
  const pubkeys = new Set<string>()
  for (let index = 0; index < limit; index += 1) {
    const material = marketplace.seed.deriveTradeMaterial(payload.seed, {
      index,
      role: 'buyer',
      extra: 'auction-bid',
    })
    pubkeys.add(material.tradePubkey)
  }
  return pubkeys
}

import * as marketplace from 'nostr-tools/marketplace'

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

function bidGroupKey(group: marketplace.ParsedAuctionBidGroup): string {
  return `${group.auctionAnchor}:${group.tradeId}`
}

export function isOwnBidChain(
  chain: marketplace.ParsedAuctionBidChain,
  ownBidGroups: Iterable<marketplace.ParsedAuctionBidGroup>,
): boolean {
  const ownGroupKeys = new Set<string>()
  const ownBidIds = new Set<string>()
  const ownPaymentIds = new Set<string>()
  for (const group of ownBidGroups) {
    ownGroupKeys.add(bidGroupKey(group))
    ownBidIds.add(group.bid.event.id)
    for (const payment of group.payments) ownPaymentIds.add(payment.event.id)
  }
  return chain.groups.some(group =>
    ownGroupKeys.has(bidGroupKey(group)) ||
    ownBidIds.has(group.bid.event.id) ||
    group.payments.some(payment => ownPaymentIds.has(payment.event.id)),
  )
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

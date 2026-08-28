export type EscrowDashboardAction = {
  id: string
  label: string
  description?: string
  enabled: boolean
  unavailableReason?: string
}

export type EscrowDashboardDriver = {
  id: string
  label: string
  status: string
  error?: string
}

export type EscrowDashboardValidation = {
  status: string
  error?: string
}

export type EscrowDashboardRecord = {
  id: string
  kind: 'order' | 'auction_bid'
  tradeId: string
  listingAnchor: string
  auctionAnchor?: string
  stage: string
  updatedAt: number
  driver?: EscrowDashboardDriver
  validation?: EscrowDashboardValidation
  actions: EscrowDashboardAction[]
  actionReason?: string
}

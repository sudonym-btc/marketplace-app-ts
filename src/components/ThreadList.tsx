import type * as marketplace from 'nostr-tools/marketplace'

import type { ConversationGroup } from '../nostr/inboxThreads'
import { shortPubkey } from '../nostr/inboxThreads'
import type { NostrProfile } from '../nostr/profiles'
import { OrderWidget } from './OrderWidget'
import { profileLabel } from './ProfileChip'

type Props = {
  groups: ConversationGroup[]
  selectedId?: string
  profiles: Map<string, NostrProfile>
  currentPubkey: string
  onSelect: (id: string) => void
  onCancelOrder?: (group: marketplace.ParsedOrderGroup) => void | Promise<void>
  onMessageEscrow?: (group: marketplace.ParsedOrderGroup) => void
}

function threadTitle(group: ConversationGroup, profiles: Map<string, NostrProfile>, currentPubkey: string): string {
  const peers = group.replyPubkeys.filter(pubkey => pubkey !== currentPubkey)
  const named = (peers.length > 0 ? peers : group.replyPubkeys).map(pubkey => profileLabel(pubkey, profiles.get(pubkey)))
  if (named.length > 0) return named.slice(0, 3).join(', ')
  return shortPubkey(group.conversationTag)
}

function threadPreview(group: ConversationGroup): string {
  if (group.latestMessage) return group.latestMessage.body || group.latestMessage.title
  if (group.orderGroup) return 'Order conversation'
  return 'No messages yet'
}

export function ThreadList({
  groups,
  selectedId,
  profiles,
  currentPubkey,
  onSelect,
  onCancelOrder,
  onMessageEscrow,
}: Props) {
  return (
    <aside className="thread-list" aria-label="Inbox conversations">
      {groups.map(group => (
        <article
          className={`thread-list-item${group.id === selectedId ? ' active' : ''}`}
          key={group.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(group.id)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect(group.id)
            }
          }}
        >
          <span className="thread-list-title">{threadTitle(group, profiles, currentPubkey)}</span>
          <span className="thread-list-meta">
            <span>{group.messages.length} message{group.messages.length === 1 ? '' : 's'}</span>
            <span>{new Date(group.latestAt * 1000).toLocaleDateString()}</span>
          </span>
          <span className="thread-list-preview">{threadPreview(group)}</span>
          {group.orderGroup && (
            <OrderWidget
              compact
              group={group.orderGroup}
              onCancel={onCancelOrder}
              onMessageEscrow={onMessageEscrow}
            />
          )}
        </article>
      ))}
    </aside>
  )
}

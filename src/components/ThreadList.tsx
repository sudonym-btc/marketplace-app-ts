import type * as marketplace from 'nostr-tools/marketplace'

import type { ConversationGroup } from '../nostr/inboxThreads'
import { shortPubkey } from '../nostr/inboxThreads'
import type { NostrProfile } from '../nostr/profiles'
import { OrderWidget } from './OrderWidget'
import { profileLabel } from './ProfileChip'
import { cn } from './ui'

type Props = {
  groups: ConversationGroup[]
  selectedId?: string
  profiles: Map<string, NostrProfile>
  currentPubkey: string
  onSelect: (id: string) => void
  onCancelOrder?: (group: marketplace.ParsedOrderGroup) => void | Promise<void>
  onMessageArbiter?: (group: marketplace.ParsedOrderGroup) => void
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
  onMessageArbiter,
}: Props) {
  return (
    <aside className="min-h-0 min-w-0 overflow-y-auto border-r border-border bg-muted/30 max-[860px]:max-h-72 max-[860px]:border-b max-[860px]:border-r-0" aria-label="Inbox conversations">
      {groups.map(group => (
        <article
          className={cn(
            'grid w-full cursor-pointer gap-2 border-b border-border bg-transparent p-4 text-left text-foreground transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring hover:bg-background',
            group.id === selectedId && 'bg-background shadow-[inset_3px_0_0_var(--foreground)]',
          )}
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
          <span className="truncate text-sm font-semibold">{threadTitle(group, profiles, currentPubkey)}</span>
          <span className="flex justify-between gap-3 text-xs text-muted-foreground">
            <span>{group.messages.length} message{group.messages.length === 1 ? '' : 's'}</span>
            <span>{new Date(group.latestAt * 1000).toLocaleDateString()}</span>
          </span>
          <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">{threadPreview(group)}</span>
          {group.orderGroup && (
            <OrderWidget
              compact
              group={group.orderGroup}
              onCancel={onCancelOrder}
              onMessageArbiter={onMessageArbiter}
            />
          )}
        </article>
      ))}
    </aside>
  )
}

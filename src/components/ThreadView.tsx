import { useState } from 'react'
import type { FormEvent } from 'react'
import type * as marketplace from 'nostr-tools/marketplace'

import {
  shortPubkey,
  type ConversationGroup,
  type ParsedInboxMessage,
} from '../nostr/inboxThreads'
import type { NostrProfile } from '../nostr/profiles'
import { OrderWidget } from './OrderWidget'
import { ProfileChip, profileLabel } from './ProfileChip'
import {
  Bubble,
  BubbleContent,
  Button,
  Marker,
  MarkerContent,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Textarea,
  cn,
} from './ui'
import { Field } from './widgets/FormField'
import { ReservationOfferWidget } from './widgets/ReservationOfferWidget'

type Props = {
  group?: ConversationGroup
  profiles: Map<string, NostrProfile>
  currentPubkey: string
  onReply: (group: ConversationGroup, content: string) => Promise<void>
  onCancelOrder?: (group: marketplace.ParsedOrderGroup) => void | Promise<void>
  onMessageArbiter?: (group: marketplace.ParsedOrderGroup) => void
}

function MessageBody({ message }: { message: ParsedInboxMessage }) {
  if (message.order) return <ReservationOfferWidget order={message.order} />
  if (message.item.error) return <p className="m-0 text-sm text-destructive">{message.item.error}</p>
  return <p className="m-0 text-sm leading-6 text-inherit">{message.body || 'No message body'}</p>
}

function ThreadAvatar({
  pubkey,
  profile,
}: {
  pubkey: string
  profile?: NostrProfile
}) {
  const label = profileLabel(pubkey, profile)
  return (
    <MessageAvatar title={pubkey}>
      {profile?.picture ? (
        <img
          alt=""
          className="size-8 object-cover"
          loading="lazy"
          src={profile.picture}
        />
      ) : (
        <span className="grid size-8 place-items-center text-xs font-semibold text-foreground">
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
    </MessageAvatar>
  )
}

function ThreadMessage({ message, profiles, currentPubkey }: {
  message: ParsedInboxMessage
  profiles: Map<string, NostrProfile>
  currentPubkey: string
}) {
  const isMine = message.senderPubkey === currentPubkey
  const align = isMine ? 'end' : 'start'
  const profile = profiles.get(message.senderPubkey)
  const bubbleVariant = message.item.error
    ? 'destructive'
    : message.order
      ? 'outline'
      : isMine
        ? 'default'
        : 'secondary'
  return (
    <Message align={align}>
      <ThreadAvatar pubkey={message.senderPubkey} profile={profile} />
      <MessageContent className="max-w-[min(44rem,100%)]">
        <MessageHeader className={cn('gap-2', isMine && 'justify-end')}>
          <span className="truncate">{profileLabel(message.senderPubkey, profile)}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{new Date(message.createdAt * 1000).toLocaleString()}</span>
        </MessageHeader>
        <Bubble align={align} className={message.order ? 'max-w-[min(44rem,100%)]' : undefined} variant={bubbleVariant}>
          <BubbleContent className={cn(message.order && 'w-full p-3')}>
            <MessageBody message={message} />
          </BubbleContent>
        </Bubble>
        <MessageFooter className={cn('gap-2', isMine && 'justify-end')}>
          <span className="truncate">{message.title}</span>
          {isMine && (
            <>
              <span aria-hidden="true">·</span>
              <span>Sent</span>
            </>
          )}
        </MessageFooter>
      </MessageContent>
    </Message>
  )
}

export function ThreadView({
  group,
  profiles,
  currentPubkey,
  onReply,
  onCancelOrder,
  onMessageArbiter,
}: Props) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!group || !draft.trim()) return
    setSending(true)
    setError(undefined)
    try {
      await onReply(group, draft)
      setDraft('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to send reply'
      console.warn('[marketplace-app] thread reply failed', { conversationId: group.id }, err)
      setError(message)
    } finally {
      setSending(false)
    }
  }

  if (!group) {
    return (
      <section className="grid min-h-0 min-w-0 place-items-center text-muted-foreground">
        <p className="text-sm">Select a conversation.</p>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
        {group.replyPubkeys.map(pubkey => (
          <ProfileChip
            compact
            key={pubkey}
            pubkey={pubkey}
            profile={profiles.get(pubkey)}
          />
        ))}
      </div>

      {group.orderGroup && (
        <div className="border-b border-border bg-background px-5 py-3">
          <OrderWidget
            group={group.orderGroup}
            onCancel={onCancelOrder}
            onMessageArbiter={onMessageArbiter}
          />
        </div>
      )}

      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="flex-1 bg-muted/30">
          <MessageScrollerViewport className="p-5">
            <MessageScrollerContent className="gap-4">
              {group.messages.length === 0 ? (
                <MessageScrollerItem scrollAnchor>
                  <Marker variant="separator">
                    <MarkerContent>No private messages in this order thread yet.</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              ) : (
                group.messages.map(message => (
                  <MessageScrollerItem
                    key={message.messageId}
                    messageId={message.messageId}
                    scrollAnchor
                  >
                    <ThreadMessage
                      currentPubkey={currentPubkey}
                      message={message}
                      profiles={profiles}
                    />
                  </MessageScrollerItem>
                ))
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form className="grid gap-3 border-t border-border bg-background px-5 py-4" onSubmit={submit}>
        <Field label="Reply">
          <Textarea
            className="min-h-24"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="Write a reply..."
            disabled={sending}
          />
        </Field>
        {error && <p className="m-0 text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-4 max-[640px]:items-stretch max-[640px]:flex-col">
          <span className="text-sm text-muted-foreground">{group.replyPubkeys.filter(pubkey => pubkey !== currentPubkey).length} recipient(s)</span>
          <Button type="submit" disabled={sending || !draft.trim()}>
            {sending ? 'Sending...' : 'Send reply'}
          </Button>
        </div>
      </form>
    </section>
  )
}

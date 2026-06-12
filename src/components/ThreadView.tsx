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
import { ProfileChip } from './ProfileChip'
import { Button, Card, Textarea, cn } from './ui'
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
  return <p className="m-0 text-sm leading-6 text-muted-foreground">{message.body || 'No message body'}</p>
}

function ThreadMessage({ message, profiles, currentPubkey }: {
  message: ParsedInboxMessage
  profiles: Map<string, NostrProfile>
  currentPubkey: string
}) {
  const isMine = message.senderPubkey === currentPubkey
  return (
    <Card className={cn('grid max-w-3xl gap-3 p-4 shadow-none', isMine && 'justify-self-end')}>
      <header className="flex items-center justify-between gap-4">
        <ProfileChip pubkey={message.senderPubkey} profile={profiles.get(message.senderPubkey)} />
        <span className="text-right text-xs text-muted-foreground">{new Date(message.createdAt * 1000).toLocaleString()}</span>
      </header>
      <div className="flex items-start justify-between gap-4">
        <h3 className="m-0 text-base font-semibold text-foreground">{message.title}</h3>
        {isMine && <span className="text-xs font-medium text-muted-foreground">Sent</span>}
      </div>
      <MessageBody message={message} />
    </Card>
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

      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto bg-muted/30 p-5">
        {group.messages.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No private messages in this order thread yet.</p>
        ) : (
          group.messages.map(message => (
            <ThreadMessage
              currentPubkey={currentPubkey}
              key={message.messageId}
              message={message}
              profiles={profiles}
            />
          ))
        )}
      </div>

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

import { useState } from 'react'
import type { FormEvent } from 'react'
import type * as marketplace from 'nostr-tools/marketplace'

import {
  formatAmount,
  formatDate,
  shortPubkey,
  type ConversationGroup,
  type ParsedInboxMessage,
} from '../nostr/inboxThreads'
import type { NostrProfile } from '../nostr/profiles'
import { OrderWidget } from './OrderWidget'
import { ProfileChip } from './ProfileChip'

type Props = {
  group?: ConversationGroup
  profiles: Map<string, NostrProfile>
  currentPubkey: string
  onReply: (group: ConversationGroup, content: string) => Promise<void>
  onCancelOrder?: (group: marketplace.ParsedOrderGroup) => void | Promise<void>
  onMessageEscrow?: (group: marketplace.ParsedOrderGroup) => void
}

function OrderDetails({ order }: { order: marketplace.ParsedOrder }) {
  const start = formatDate(order.content.start)
  const end = formatDate(order.content.end)
  return (
    <dl className="message-facts">
      <div>
        <dt>Amount</dt>
        <dd>{formatAmount(order.content.amount)}</dd>
      </div>
      {start && (
        <div>
          <dt>Start</dt>
          <dd>{start}</dd>
        </div>
      )}
      {end && (
        <div>
          <dt>End</dt>
          <dd>{end}</dd>
        </div>
      )}
      <div>
        <dt>Quantity</dt>
        <dd>{order.content.quantity}</dd>
      </div>
      <div>
        <dt>Trade</dt>
        <dd><code>{shortPubkey(order.tradeId)}</code></dd>
      </div>
    </dl>
  )
}

function MessageBody({ message }: { message: ParsedInboxMessage }) {
  if (message.order) return <OrderDetails order={message.order} />
  if (message.item.error) return <p className="message-error">{message.item.error}</p>
  return <p>{message.body || 'No message body'}</p>
}

function ThreadMessage({ message, profiles, currentPubkey }: {
  message: ParsedInboxMessage
  profiles: Map<string, NostrProfile>
  currentPubkey: string
}) {
  const isMine = message.senderPubkey === currentPubkey
  return (
    <article className={`message-row${isMine ? ' own' : ''}`}>
      <header className="message-header">
        <ProfileChip pubkey={message.senderPubkey} profile={profiles.get(message.senderPubkey)} />
        <span>{new Date(message.createdAt * 1000).toLocaleString()}</span>
      </header>
      <div className="message-title-row">
        <h3>{message.title}</h3>
        {isMine && <span>Sent</span>}
      </div>
      <MessageBody message={message} />
    </article>
  )
}

export function ThreadView({
  group,
  profiles,
  currentPubkey,
  onReply,
  onCancelOrder,
  onMessageEscrow,
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
      <section className="thread-view empty">
        <p>Select a conversation.</p>
      </section>
    )
  }

  return (
    <section className="thread-view">
      <div className="conversation-participants">
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
        <div className="thread-order-panel">
          <OrderWidget
            group={group.orderGroup}
            onCancel={onCancelOrder}
            onMessageEscrow={onMessageEscrow}
          />
        </div>
      )}

      <div className="thread-messages">
        {group.messages.length === 0 ? (
          <p className="thread-empty-message">No private messages in this order thread yet.</p>
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

      <form className="thread-composer" onSubmit={submit}>
        <label>
          <span>Reply</span>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="Write a reply..."
            disabled={sending}
          />
        </label>
        {error && <p className="message-error">{error}</p>}
        <div className="composer-actions">
          <span>{group.replyPubkeys.filter(pubkey => pubkey !== currentPubkey).length} recipient(s)</span>
          <button className="button" type="submit" disabled={sending || !draft.trim()}>
            {sending ? 'Sending...' : 'Send reply'}
          </button>
        </div>
      </form>
    </section>
  )
}

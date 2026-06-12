type PaymentLogProps = {
  messages: string[]
}

export function PaymentLog({ messages }: PaymentLogProps) {
  if (messages.length === 0) return null
  return (
    <pre className="m-0 max-h-60 overflow-auto rounded-md border border-border bg-foreground p-3 text-xs leading-5 text-background whitespace-pre-wrap break-words">
      {messages.join('\n\n')}
    </pre>
  )
}

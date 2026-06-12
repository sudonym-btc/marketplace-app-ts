import { Card } from './ui'

type Props = {
  title: string
  body: string
}

export function EmptyState({ title, body }: Props) {
  return (
    <Card className="grid place-items-center gap-2 px-6 py-10 text-center">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="max-w-xl text-sm leading-6 text-muted-foreground">{body}</p>
    </Card>
  )
}

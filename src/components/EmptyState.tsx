type Props = {
  title: string
  body: string
}

export function EmptyState({ title, body }: Props) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  )
}

import Countdown, { type CountdownRenderProps } from 'react-countdown'
import TimeAgo from 'react-timeago'

import { formatDateTime } from '../../utils/timeDisplay'

type TimeProps = {
  className?: string
  seconds?: number
}

function countdownText({ days, formatted, completed }: CountdownRenderProps): string {
  if (completed) return ''
  if (days > 0) return `Ends in ${days}d ${formatted.hours}h ${formatted.minutes}m`
  return `Ends in ${formatted.hours}:${formatted.minutes}:${formatted.seconds}`
}

export function TimeAgoText({ className, seconds }: TimeProps) {
  if (seconds === undefined) return <span className={className}>unknown time</span>
  return (
    <span className={className}>
      <TimeAgo date={seconds * 1000} live />
    </span>
  )
}

export function AuctionCountdownText({ className, seconds }: TimeProps) {
  if (seconds === undefined) return <span className={className}>No end time</span>
  const endMs = seconds * 1000
  return (
    <Countdown
      date={endMs}
      renderer={props => (
        <span className={className}>
          {props.completed ? (
            <>
              Ended <TimeAgo date={endMs} live />
            </>
          ) : countdownText(props)}
        </span>
      )}
    />
  )
}

export function AuctionEndValue({ seconds }: { seconds?: number }) {
  return (
    <span className="grid gap-1">
      <span>{formatDateTime(seconds)}</span>
      <AuctionCountdownText className="text-xs font-normal text-muted-foreground" seconds={seconds} />
    </span>
  )
}

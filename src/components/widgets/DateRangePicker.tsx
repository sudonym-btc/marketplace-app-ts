import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'

import {
  Button,
  Calendar,
  Field,
  FieldLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui'

type DateRangePickerProps = {
  end: string
  id?: string
  label: string
  onChange(range: { start: string; end: string }): void
  start: string
}

function dateFromValue(value: string): Date | undefined {
  if (!value) return undefined
  const [datePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function valueFromDate(date: Date | undefined): string {
  if (!date) return ''
  return format(date, 'yyyy-MM-dd')
}

function rangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return 'Pick dates'
  if (!range.to) return format(range.from, 'LLL dd, y')
  return `${format(range.from, 'LLL dd, y')} - ${format(range.to, 'LLL dd, y')}`
}

export function DateRangePicker({
  end,
  id = 'date-picker-range',
  label,
  onChange,
  start,
}: DateRangePickerProps) {
  const selected: DateRange | undefined = start || end
    ? {
        from: dateFromValue(start),
        to: dateFromValue(end),
      }
    : undefined

  function selectRange(nextRange: DateRange | undefined): void {
    onChange({
      start: valueFromDate(nextRange?.from),
      end: valueFromDate(nextRange?.to),
    })
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            className="w-full justify-start px-2.5 font-normal"
            id={id}
            variant="outline"
          >
            <CalendarIcon />
            <span className="truncate">{rangeLabel(selected)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            defaultMonth={selected?.from}
            mode="range"
            numberOfMonths={2}
            onSelect={selectRange}
            selected={selected}
          />
        </PopoverContent>
      </Popover>
    </Field>
  )
}

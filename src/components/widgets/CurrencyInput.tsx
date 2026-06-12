import { useEffect, useMemo, type ChangeEvent, type ComponentProps, type FocusEvent } from 'react'

import { FieldError, Input, cn } from '../ui'
import {
  normalizeCurrencyInputValue,
  validateCurrencyAmountInput,
  type CurrencyAmount,
  type CurrencyAmountValidation,
} from '../../utils/currencyAmount'

type CurrencyInputProps = Omit<
  ComponentProps<'input'>,
  'inputMode' | 'max' | 'min' | 'onChange' | 'type' | 'value'
> & {
  currency: string
  decimals?: number
  max?: CurrencyAmount[]
  min?: CurrencyAmount[]
  onValidationChange?(validation: CurrencyAmountValidation): void
  onValueChange(value: string, parsed?: CurrencyAmount): void
  showCurrency?: boolean
  showError?: boolean
  value: string
}

export function CurrencyInput({
  className,
  currency,
  decimals,
  max,
  min,
  onBlur,
  onValidationChange,
  onValueChange,
  required,
  showCurrency = true,
  showError = true,
  value,
  ...props
}: CurrencyInputProps) {
  const validation = useMemo(
    () => validateCurrencyAmountInput(value, {
      decimals,
      denomination: currency,
      max,
      min,
      required,
    }),
    [currency, decimals, max, min, required, value],
  )

  useEffect(() => {
    onValidationChange?.(validation)
  }, [onValidationChange, validation])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = normalizeCurrencyInputValue(event.target.value)
    const nextValidation = validateCurrencyAmountInput(nextValue, {
      decimals,
      denomination: currency,
      max,
      min,
      required,
    })
    onValueChange(nextValue, nextValidation.parsed)
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    if (value.endsWith('.')) {
      const nextValue = value.slice(0, -1)
      const nextValidation = validateCurrencyAmountInput(nextValue, {
        decimals,
        denomination: currency,
        max,
        min,
        required,
      })
      onValueChange(nextValue, nextValidation.parsed)
    }
    onBlur?.(event)
  }

  const invalid = !validation.valid && Boolean(validation.error)

  return (
    <div className="grid gap-1.5" data-slot="currency-input">
      <div className="relative">
        <Input
          {...props}
          aria-invalid={invalid || props['aria-invalid'] || undefined}
          className={cn('tabular-nums', showCurrency && currency && 'pr-16', className)}
          inputMode={decimals === 0 ? 'numeric' : 'decimal'}
          onBlur={handleBlur}
          onChange={handleChange}
          required={required}
          type="text"
          value={value}
        />
        {showCurrency && currency && (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-medium text-muted-foreground">
            {currency}
          </span>
        )}
      </div>
      {showError && validation.error && <FieldError>{validation.error}</FieldError>}
    </div>
  )
}

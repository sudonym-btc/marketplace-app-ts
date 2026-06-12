import { useEffect, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { PlusIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '../ui'
import { Field } from './FormField'

export type ListingSearchValues = {
  categories: string[]
  location: string
}

type Props = {
  error?: string
  loading?: boolean
  onClear(): void
  onOpenChange(open: boolean): void
  onSubmit(values: ListingSearchValues): Promise<void> | void
  open: boolean
  values?: ListingSearchValues
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))]
}

export function ListingSearchDialog({
  error,
  loading = false,
  onClear,
  onOpenChange,
  onSubmit,
  open,
  values,
}: Props) {
  const [location, setLocation] = useState(values?.location ?? '')
  const [categoryInput, setCategoryInput] = useState('')
  const [categories, setCategories] = useState<string[]>(values?.categories ?? [])

  useEffect(() => {
    if (!open) return
    setLocation(values?.location ?? '')
    setCategories(values?.categories ?? [])
    setCategoryInput('')
  }, [open, values])

  function addCategory(rawValue = categoryInput): void {
    const nextValue = rawValue.trim()
    if (!nextValue) return
    setCategories(current => uniqueTags([...current, nextValue]))
    setCategoryInput('')
  }

  function removeCategory(category: string): void {
    setCategories(current => current.filter(item => item !== category))
  }

  function handleCategoryKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter' && event.key !== ',') return
    event.preventDefault()
    addCategory()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await onSubmit({
      categories: uniqueTags([...categories, categoryInput]),
      location: location.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontalIcon className="size-4" />
              Search listings
            </DialogTitle>
            <DialogDescription className="sr-only">
              Filter listings by location and product category.
            </DialogDescription>
          </DialogHeader>
          <Field label="Location">
            <Input
              autoComplete="off"
              placeholder="Germany"
              value={location}
              onChange={event => setLocation(event.target.value)}
            />
          </Field>
          <Field label="Product category">
            <div className="flex gap-2">
              <Input
                autoComplete="off"
                placeholder="camera"
                value={categoryInput}
                onChange={event => setCategoryInput(event.target.value)}
                onKeyDown={handleCategoryKeyDown}
              />
              <Button
                aria-label="Add category"
                disabled={!categoryInput.trim()}
                size="icon"
                type="button"
                variant="outline"
                onClick={() => addCategory()}
              >
                <PlusIcon />
              </Button>
            </div>
          </Field>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categories.map(category => (
                <Badge key={category} className="gap-1 pr-1" variant="secondary">
                  {category}
                  <Button
                    aria-label={`Remove ${category}`}
                    className="size-5 rounded-md"
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                    onClick={() => removeCategory(category)}
                  >
                    <XIcon />
                  </Button>
                </Badge>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button disabled={loading} type="button" variant="outline" onClick={onClear}>
              Clear
            </Button>
            <Button disabled={loading} type="submit">
              <SearchIcon />
              Search
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

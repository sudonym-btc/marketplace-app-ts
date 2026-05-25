import type { AppRoute } from '../types'

export function routeFromHash(hash = window.location.hash): AppRoute {
  const value = hash.replace(/^#\/?/, '')
  const [name, id] = value.split('/')
  if (name === 'listing' && id) return { name: 'listing', id }
  if (name === 'inbox') return { name: 'inbox' }
  if (name === 'orders') return { name: 'orders' }
  if (name === 'edit-listing') return { name: 'edit-listing', id }
  if (name === 'settings') return { name: 'settings' }
  return { name: 'listings' }
}

export function routeHref(route: AppRoute): string {
  switch (route.name) {
    case 'listing':
      return `#/listing/${route.id}`
    case 'inbox':
      return '#/inbox'
    case 'orders':
      return '#/orders'
    case 'edit-listing':
      return route.id ? `#/edit-listing/${route.id}` : '#/edit-listing'
    case 'settings':
      return '#/settings'
    default:
      return '#/'
  }
}

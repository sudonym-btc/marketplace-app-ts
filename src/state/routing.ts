import type { AppRoute } from '../types'

export function routeFromHash(hash = window.location.hash): AppRoute {
  const value = hash.replace(/^#\/?/, '')
  const [name, id, extra] = value.split('/')
  if (name === 'login') return { name: 'login' }
  if (name === 'auctions') return { name: 'auctions' }
  if (name === 'listing' && id) return { name: 'listing', id }
  if (name === 'inbox') {
    if (id && extra) {
      return {
        name: 'inbox',
        thread: {
          conversation: decodeURIComponent(id),
          participants: extra.split(',').map(value => decodeURIComponent(value)).filter(Boolean),
        },
      }
    }
    return { name: 'inbox' }
  }
  if (name === 'orders') return { name: 'orders' }
  if (name === 'my-listings') return { name: 'my-listings' }
  if (name === 'edit-listing') return { name: 'edit-listing', id }
  if (name === 'settings') return { name: 'settings' }
  return { name: 'listings' }
}

export function routeHref(route: AppRoute): string {
  switch (route.name) {
    case 'listing':
      return `#/listing/${route.id}`
    case 'login':
      return '#/login'
    case 'auctions':
      return '#/auctions'
    case 'inbox':
      if (route.thread) {
        return `#/inbox/${encodeURIComponent(route.thread.conversation)}/${route.thread.participants
          .map(participant => encodeURIComponent(participant))
          .join(',')}`
      }
      return '#/inbox'
    case 'orders':
      return '#/orders'
    case 'my-listings':
      return '#/my-listings'
    case 'edit-listing':
      return route.id ? `#/edit-listing/${route.id}` : '#/edit-listing'
    case 'settings':
      return '#/settings'
    default:
      return '#/'
  }
}

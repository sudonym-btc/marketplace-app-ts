import { createH3LocationProvider } from '@sudonym-btc/marketplace-location-h3'
import type * as marketplace from 'nostr-tools/marketplace'

const dummyCoordinates = {
  lat: 0,
  lng: 0,
}

const dummyAreaPolygon: marketplace.GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[
    [-0.05, -0.05],
    [0.05, -0.05],
    [0.05, 0.05],
    [-0.05, 0.05],
    [-0.05, -0.05],
  ]],
}

export function createAppLocationProvider(): marketplace.MarketplaceLocationProvider {
  return createH3LocationProvider({
    addressToCoordinates: async () => dummyCoordinates,
    areaToPolygon: async () => dummyAreaPolygon,
  })
}

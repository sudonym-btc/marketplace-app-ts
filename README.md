# marketplace-app-ts

Nostr marketplace web app with:

- NIP-46 bunker / Nostr Connect login.
- Marketplace seed recovery through Nostr self-encrypted seed events.
- EVM marketplace driver using `@sudonym-btc/marketplace-evm`.
- Startup payment method publishing.
- Startup EVM driver discovery/sweep hook.
- Classified listings, listing detail checkout, inbox, orders, and listing editor.

The app defaults to NMDK's local relay at `ws://127.0.0.1:18080`. Override
`VITE_RELAYS` with a comma-separated relay list when needed.

This repo is designed to run inside the NMDK dependency tree beside:

- `../nostr-tools`
- `../marketplace-evm-ts`

## Run

```sh
npm install
npm run dev
```

Open `http://localhost:5178`.

Development mode loads `.env.development`, which points at the standalone NMDK
localhost ports. `npm run up` at the NMDK root refreshes `.env.local` from the
generated stack configs.

## Notes

Local storage is used as a cache/session convenience only. Marketplace seed and
EVM trade material are recovered from Nostr seed events and deterministic chain
scans.

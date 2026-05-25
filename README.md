# marketplace-app-ts

Nostr marketplace web app with:

- NIP-46 bunker / Nostr Connect login.
- Marketplace seed recovery through Nostr self-encrypted seed events.
- EVM marketplace driver using `@sudonym-btc/marketplace-evm`.
- Startup escrow method publishing.
- Startup EVM driver discovery/sweep hook.
- Classified listings, listing detail checkout, inbox, orders, and listing editor.

This repo is designed to run as a Hostr dependency beside:

- `../nostr-tools`
- `../marketplace-evm-ts`

## Run

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5178`.

## Notes

Local storage is used as a cache/session convenience only. Marketplace seed and
EVM trade material are recovered from Nostr seed events and deterministic chain
scans.

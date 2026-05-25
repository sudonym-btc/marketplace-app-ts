# marketplace-app-ts

Nostr marketplace web app with:

- NIP-46 bunker / Nostr Connect login.
- Marketplace seed recovery through Nostr self-encrypted seed events.
- EVM marketplace driver using `@sudonym-btc/marketplace-evm`.
- Startup escrow method publishing.
- Startup EVM driver discovery/sweep hook.
- Classified listings, listing detail checkout, inbox, orders, and listing editor.

The app is intentionally pinned to `wss://relay.hostr.development` for relay
traffic. It does not fall back to public relays.

This repo is designed to run as a Hostr dependency beside:

- `../nostr-tools`
- `../marketplace-evm-ts`

## Run

```sh
npm install
npm run dev
```

Open `http://localhost:5178`.

Development mode loads `.env.development`, which mirrors Hostr's Arbitrum
regtest endpoints and contract addresses. Copy `.env.example` to `.env.local`
only when overriding those defaults locally.

## Notes

Local storage is used as a cache/session convenience only. Marketplace seed and
EVM trade material are recovered from Nostr seed events and deterministic chain
scans.

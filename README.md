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

## One-command local demo

From this folder:

```sh
npm install
npm run up
```

`npm run up` starts the full NMDK local stack from the parent repository and then
starts the Vite client. Open `http://localhost:5178`.

The stack launcher starts:

- shared regtest Bitcoin, marketplace LND, LNbits, and Alby Hub
- EVM/Boltz services, local Arbitrum and Rootstock RPCs, AA bundler, and paymaster
- Cashu sat/USD mints and the local Nostr relay
- Signet remote signer, Blossom upload server, and local HTTPS development proxy
- deterministic marketplace seed data, Signet keys, and arbiter daemons

The same launch from the NMDK root is:

```sh
npm run demo:up
```

For deterministic one-command launches, the parent stack resets disposable
EVM/Boltz regtest volumes by default. Prefix the command with
`MARKETPLACE_EVM_RESET_ON_UP=0` only when you deliberately want to preserve
those volumes.

If the stack is in a bad state, pull everything down and launch it again:

```sh
npm run down
npm run up
```

Docker Desktop or another Docker daemon must be running before launching the
stack.

## App-only development

```sh
npm install
npm run dev
```

Use app-only development when the NMDK services are already running. Open
`http://localhost:5178`.

Development mode loads `.env.development`, which points at the standalone NMDK
localhost ports. `npm run up` at the NMDK root refreshes `.env.local` from the
generated stack configs.

## Compile checks

```sh
npm run check
npm run build
```

## Notes

Local storage is used as a cache/session convenience only. Marketplace seed and
EVM trade material are recovered from Nostr seed events and deterministic chain
scans.

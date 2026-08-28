# marketplace-app-ts

Nostr marketplace web app with:

- NIP-46 bunker / Nostr Connect login.
- Marketplace seed recovery through Nostr self-encrypted seed events.
- EVM marketplace driver using `@sudonym-btc/marketplace-evm`.
- Startup payment method publishing.
- Startup EVM driver discovery/sweep hook.
- Classified listings, listing detail checkout, inbox, orders, and listing editor.
- An escrow dashboard for driver-validated orders and auction bids.

The app defaults to NMDK's local relay at `ws://127.0.0.1:18080`. Override
`VITE_RELAYS` with a comma-separated relay list when needed.

This repo is designed to run inside the NMDK dependency tree beside:

- `../nostr-tools`
- `../marketplace-evm-ts`

## Fresh local demo in two steps

From any working directory:

```sh
git clone --recurse-submodules https://github.com/sudonym-btc/nmdk.git && cd nmdk
npm run demo:quickstart
```

`demo:quickstart` verifies the supported toolchain, installs the pinned
workspace, cold-starts the full NMDK stack, seeds deterministic fixtures, and
starts the Vite client. Open `http://127.0.0.1:5178`. Choose **Buyer** for the
marketplace walkthrough, or **Arbiter - EVM** and open **Escrow → Dashboard**
to inspect trades naming that escrow identity.

The stack launcher starts:

- shared regtest Bitcoin, marketplace LND, LNbits, and Alby Hub
- EVM/Boltz services, local Arbitrum and Rootstock RPCs, AA bundler, and paymaster
- Cashu sat/USD mints and the local Nostr relay
- Signet remote signer, Blossom upload server, and local HTTPS development proxy
- deterministic marketplace seed data, Signet keys, and arbiter daemons

When this submodule is already checked out inside NMDK, the shorter developer
launch remains available:

```sh
npm install
npm run up
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

## Escrow dashboard API

The dashboard is deliberately a thin view over the signed-in marketplace
session. It lists and watches only records where that identity is the selected
escrow, and delegates every action back to the matching driver:

```ts
const records = await session.escrow.records.list()
const live = session.escrow.records.watch()
for await (const state of session.escrow.execute(record, 'release')) {
  // render driver progress
}
live.close()
```

Actions are fail-closed. A record has no `release` or `refund` action unless its
payment is committed, validation is accepted, and the ready payment driver
explicitly advertises and implements that action. Execution refetches and
revalidates the record, so a stale dashboard cannot authorize settlement.
Auction bids are currently monitor-only because safe auction settlement needs
whole-auction context.

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

Boltz is not enabled from an API URL alone. `VITE_EVM_BOLTZ_TRUST` must contain
the deployment-pinned ERC20Swap and optional DEX call-target addresses, runtime
bytecode hashes, selectors, and semantic decoder IDs. The root stack derives
this JSON from bytecode actually deployed by the local EVM stack. If the value
is missing or invalid, the app keeps direct EVM routes available, disables all
Lightning-to-EVM swap fallbacks before contacting Boltz, and reports why.

## Arbiter durability and settlement credentials

`arbiter.ts` writes only recovery journals and idempotency records beneath
`MARKETPLACE_ARBITER_STATE_DIR`. That directory must be writable, private to one
arbiter process, and backed by durable storage. The root NMDK Compose file gives
each local arbiter its own named volume, so `--force-recreate` does not discard
pending submissions or completed-operation tombstones. The daemon enforces mode
`0700` on the directory and mode `0600` on each state file.

An arbiter serving `evm-auction` must also control the EVM address configured in
`VITE_EVM_ARBITER_ADDRESS`. Supply its 32-byte key through the deployment's
secret mechanism as `MARKETPLACE_EVM_ARBITER_PRIVATE_KEY`. The local development
stack instead points `MARKETPLACE_EVM_STACK_CONFIG` at its generated, disposable
Anvil account file. Startup fails before subscribing to orders if the derived
account does not exactly match the advertised arbiter address or if a durable
AA settlement executor cannot be constructed.

The browser dashboard never accepts a production settlement credential. For
the disposable localhost demo only, the root launcher writes the generated
Anvil key to the ignored, mode-`0600` `.env.local` file. The app reads that key
only in Vite development mode on loopback or `*.marketplace.test`, only exposes
actions to the matching Nostr arbiter, and verifies the derived EVM address.
Production builds omit this development branch; real deployments must keep
settlement keys in a server-side signer.

## Compile checks

```sh
npm run check
npm test
npm run build
```

## Notes

Local storage is used as a cache/session convenience only. Marketplace seed and
EVM trade material are recovered from Nostr seed events and deterministic chain
scans.

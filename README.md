# FiberScope

FiberScope is a hackathon prototype for Fiber Network operators. It turns FNN RPC snapshots into an actionable route-readiness report: peer health, channel state, visible graph, dry-run payment failures, Biscuit scope issues, and circular rebalance candidates.

The gap: Fiber already exposes the primitives needed to operate a node, but the operator has to stitch together `node_info`, `list_peers`, `list_channels`, `graph_channels`, `send_payment` dry runs, and the rebalancing docs by hand. FiberScope makes that failure path reviewable in one CLI and dashboard.

## Quick Start

```bash
npm install
npm run verify
npm run dashboard
```

Dashboard: `http://127.0.0.1:4173/`

The prototype has no runtime package dependencies; `npm install` only creates the local package metadata.

License: MIT. See [`LICENSE`](LICENSE).

## CLI

```bash
npm run fiber-scope -- fixtures
npm run fiber-scope -- inspect --snapshot fixtures/unbalanced-route-failure.json
npm run fiber-scope -- report --snapshot fixtures/unbalanced-route-failure.json --out reports/demo-report.md
npm run fiber-scope -- diff --before fixtures/no-peers-no-graph.json --after fixtures/unbalanced-route-failure.json
npm run fiber-scope -- presets --network testnet
npm run fiber-scope -- presets --node fiber-testnet-public-bottle --rpc http://127.0.0.1:8227
```

Demo artifact: [`docs/demo-report.md`](docs/demo-report.md).

Diff artifact: [`docs/demo-diff.md`](docs/demo-diff.md).

Submission brief: [`SUBMISSION.md`](SUBMISSION.md).

CLI transcript: [`docs/demo-transcript.md`](docs/demo-transcript.md).

Collect from a local FNN RPC endpoint:

```bash
npm run fiber-scope -- collect \
  --rpc http://127.0.0.1:8227 \
  --out snapshots/node.json \
  --graph-limit 200 \
  --graph-pages 5 \
  --amount 0x2540be400 \
  --self-rebalance
```

For protected RPC endpoints:

```bash
npm run fiber-scope -- collect \
  --rpc http://127.0.0.1:8227 \
  --auth-token <biscuit-token> \
  --out snapshots/protected-node.json
```

## What It Detects

| Fingerprint | Gap |
| --- | --- |
| `FS-PEER-NONE-001` | no connected Fiber peers |
| `FS-CHANNEL-NONE-001` | no payment channels |
| `FS-LIQUIDITY-OUTBOUND-LOW-001` | ready channels cannot carry the requested first hop amount |
| `FS-GOSSIP-CATCHUP-001` | peer/channel state exists but public graph is empty |
| `FS-ROUTE-DRYRUN-FAILED-001` | `send_payment` dry run or `build_router` failed |
| `FS-REBALANCE-CANDIDATE-001` | one outbound-heavy and one inbound-heavy channel can be probed with a circular self-payment |
| `FS-AUTH-SCOPE-001` | Biscuit token lacks diagnostic read scopes |
| `FS-MIGRATION-PUBKEY-001` | snapshot hints at pre-v0.8 `peer_id` RPC usage |

## Hackathon Fit

Primary track: Diagnostics & Visualization.

Secondary tracks: Routing & Liquidity, SDKs & Developer Tools.

The prototype is infrastructure-focused: it helps node operators, public node providers, wallet teams, and SDK builders understand why a Fiber payment path is not ready before they send a real payment.

## Fiber RPCs Used

- `node_info`
- `list_peers`
- `list_channels`
- `graph_nodes`
- `graph_channels`
- optional `send_payment` with `dry_run: true`
- optional `build_router`

The live collector follows `last_cursor` for `graph_nodes` and `graph_channels` with bounded pagination. Use `--graph-limit` to control page size and `--graph-pages` to cap collection time.

The diff command compares two snapshots and highlights peer, graph, liquidity, route, and finding changes. It is useful for showing a node before and after connecting to public nodes or waiting for gossip catch-up.

Public-node presets generate v0.8 pubkey-based `connect_peer`, `open_channel`, and `list_channels` payloads for the documented Fiber mainnet/testnet public nodes. The generated follow-up command runs FiberScope collection after the node reaches `ChannelReady`.

FiberScope follows the Fiber docs recommendation to run dry runs before real rebalances, and it generates a self-payment dry-run payload with `allow_self_payment: true`.

## Submission Pack

Run:

```bash
npm run verify
```

This refreshes the report, diff, and CLI transcript used by [`SUBMISSION.md`](SUBMISSION.md).

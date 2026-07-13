# FiberScope Hackathon Submission

## One-liner

FiberScope is a Fiber Network operator cockpit that turns FNN RPC snapshots into route-readiness diagnostics, liquidity findings, public-node setup runbooks, and before/after progress reports.

## Track Fit

Primary track: Diagnostics & Visualization.

Secondary tracks: Routing & Liquidity, SDKs & Developer Tools.

## The Gap

Fiber exposes the right primitives, but operators still have to manually correlate node state, peers, channels, graph visibility, dry-run payment errors, Biscuit auth scopes, and public-node setup docs. FiberScope compresses that workflow into one CLI and dashboard.

## What To Review

- Dashboard: `npm run dashboard`, then open `http://127.0.0.1:4173/`
- Live collector: dashboard Live RPC Lab or `npm run fiber-scope -- collect --rpc http://127.0.0.1:8227 --out snapshots/live-node.json --self-rebalance`
- Readiness gate: `npm run fiber-scope -- gate --snapshot fixtures/healthy-ready.json`
- CLI transcript: [docs/demo-transcript.md](docs/demo-transcript.md)
- Diagnostic report: [docs/demo-report.md](docs/demo-report.md)
- Snapshot diff: [docs/demo-diff.md](docs/demo-diff.md)
- Desktop screenshot: [docs/ui-desktop.png](docs/ui-desktop.png)
- Mobile screenshot: [docs/ui-mobile.png](docs/ui-mobile.png)
- License: [LICENSE](LICENSE)

## Demo Flow

```bash
npm install
npm run verify
npm run dashboard
```

Suggested reviewer path:

1. Open the dashboard.
2. Use the Live RPC Lab if a local FNN RPC endpoint is available.
3. Check the Readiness Gate to see the automation decision and blockers.
4. Look at route state, liquidity map, findings, and rebalance probe.
5. Open Snapshot Diff to see fresh-node -> route-probed-node progress.
6. Open Public Node Presets to see generated `connect_peer` and `open_channel` payloads.
7. Read [docs/demo-transcript.md](docs/demo-transcript.md) for the CLI version.

## Implemented Features

- Fixture-backed Fiber snapshot inspector.
- Live FNN RPC collector with bounded graph pagination.
- Dashboard live-collector proxy for local RPC endpoints.
- Payment-readiness gate with non-zero exit codes for automation.
- Stable diagnostic fingerprints.
- Circular rebalance candidate generation using `allow_self_payment: true`.
- Before/after snapshot diff.
- Public-node presets for documented mainnet/testnet Fiber public nodes.
- Markdown report and diff export.
- Modern responsive dashboard.
- Node test coverage for analyzer, collector, diff, and presets.

## Known Limitations

- Fixtures drive the default demo; live-node collection requires access to an FNN RPC endpoint.
- Public-node preset values are sourced from the checked local Fiber docs and should be refreshed if upstream docs change.
- The route dry-run analysis explains captured errors, but it does not yet simulate Fiber routing internally.
- The dashboard live collector only collects snapshots; it does not execute `open_channel` or real payments.

## Roadmap

- Live runbook execution from the dashboard with explicit user confirmation.
- Snapshot history and trend view.
- Fee budget simulator for route candidates.
- WSS readiness checks for browser/WASM Fiber nodes.

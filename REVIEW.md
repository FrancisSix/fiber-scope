# Review Checklist

Use this when preparing the FiberScope hackathon submission.

## One-command Verification

```bash
npm run verify
```

Expected result:

- 16 tests pass.
- Fixture list prints 4 Fiber node snapshots.
- Public node presets print testnet public nodes.
- The unbalanced fixture reports `FS-LIQUIDITY-OUTBOUND-LOW-001`.
- The route dry-run fixture reports `FS-ROUTE-DRYRUN-FAILED-001`.
- The RPC collector test follows `last_cursor` pagination for graph data.
- The dashboard collector API validates RPC URLs and does not echo Biscuit tokens.
- The generated report is written to `docs/demo-report.md`.
- The generated diff is written to `docs/demo-diff.md`.
- The generated CLI transcript is written to `docs/demo-transcript.md`.

## Manual Demo

```bash
npm run fiber-scope -- inspect --snapshot fixtures/unbalanced-route-failure.json
npm run fiber-scope -- inspect --snapshot fixtures/auth-permission-error.json
npm run fiber-scope -- report --snapshot fixtures/unbalanced-route-failure.json --out docs/demo-report.md
npm run fiber-scope -- diff --before fixtures/no-peers-no-graph.json --after fixtures/unbalanced-route-failure.json --out docs/demo-diff.md
npm run fiber-scope -- presets --node fiber-testnet-public-bottle --rpc http://127.0.0.1:8227
npm run demo:transcript
npm run dashboard
```

Dashboard URL:

```text
http://127.0.0.1:4173/
```

Optional live check:

```bash
npm run fiber-scope -- collect --rpc http://127.0.0.1:8227 --out snapshots/live-node.json --self-rebalance
```

## Reviewer Framing

FiberScope is an infrastructure diagnostic cockpit for Fiber Network operators.

It proves:

- FNN RPC snapshots can be turned into stable, reviewable findings.
- Route dry-run failures can be separated from peer, gossip, liquidity, and auth issues.
- Before/after snapshots can show peer, graph, and liquidity progress after node setup.
- Public-node presets can generate the bootstrap RPC payloads for real FNN setup.
- Circular self-payment rebalance candidates can be generated before sending funds.
- The same analysis can be consumed from CLI, Markdown report, and dashboard.
- The browser UI can collect from a local FNN endpoint through the same collector used by the CLI.

Primary hackathon track: Diagnostics & Visualization.

Secondary tracks: Routing & Liquidity, SDKs & Developer Tools.

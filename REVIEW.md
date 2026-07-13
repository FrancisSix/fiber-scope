# Review Checklist

Use this when preparing the FiberScope hackathon submission.

## One-command Verification

```bash
npm run verify
```

Expected result:

- 23 tests pass.
- Fixture list prints 4 Fiber node snapshots.
- Public node presets print testnet public nodes.
- The unbalanced fixture reports `FS-LIQUIDITY-OUTBOUND-LOW-001`.
- The route dry-run fixture reports `FS-ROUTE-DRYRUN-FAILED-001`.
- The healthy fixture passes the strict payment-readiness gate.
- The degraded fixture fails the gate with score, status, severity, and route blockers.
- The unbalanced fixture produces two review-only `send_payment` dry runs and no real payment payload.
- The fresh-node runbook marks `connect_peer` and `open_channel` as approval-required actions.
- The RPC collector test follows `last_cursor` pagination for graph data.
- The dashboard collector API validates RPC URLs and does not echo Biscuit tokens.
- The dashboard topology renders observed graph nodes/channels and distinguishes the local node, peers, and payment target.
- Desktop and mobile layouts keep the topology, route state, runbook, and connection dialog free of horizontal overflow.
- The generated report is written to `docs/demo-report.md`.
- The generated diff is written to `docs/demo-diff.md`.
- The generated operator plan is written to `docs/demo-runbook.md`.
- The generated CLI transcript is written to `docs/demo-transcript.md`.

## Manual Demo

```bash
npm run fiber-scope -- inspect --snapshot fixtures/unbalanced-route-failure.json
npm run fiber-scope -- gate --snapshot fixtures/healthy-ready.json
npm run fiber-scope -- runbook --snapshot fixtures/unbalanced-route-failure.json
npm run fiber-scope -- runbook --snapshot fixtures/no-peers-no-graph.json --bootstrap-node fiber-testnet-public-bottle --out docs/fresh-node-runbook.md
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
- Payment readiness can be enforced with a failing CLI exit code before operators send real value.
- Stable findings can be compiled into an ordered, safety-labeled operator plan with exact Fiber RPC payloads and measurable success conditions.
- Generated payment actions are always dry runs; funding and configuration writes require explicit review and are never executed by the prototype.

Primary hackathon track: Diagnostics & Visualization.

Secondary tracks: Routing & Liquidity, SDKs & Developer Tools.

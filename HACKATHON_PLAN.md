# Gone in 60ms Hackathon Plan

## Product

Build `FiberScope`: an operator cockpit for Fiber route failures, liquidity imbalance, gossip visibility, and RPC authorization gaps.

## Why This Gap Matters

Fiber exposes the right low-level tools, but a new node operator still has to answer several questions manually:

- Is my node reachable and on the expected Fiber version?
- Do I have peers, channels, and enough local liquidity?
- Is my graph empty because gossip has not caught up, or because I am disconnected?
- Did `send_payment` fail because of path discovery, capacity, fee policy, or auth scope?
- Which circular self-payment should I dry-run before attempting a rebalance?

That diagnostic loop is exactly where infrastructure teams lose time. FiberScope compresses it into one snapshot and one report.

## MVP Scope

1. Snapshot collector for local FNN RPC.
2. Fixture-first CLI for deterministic demos.
3. Rule engine with stable fingerprints.
4. Rebalance candidate generator using `allow_self_payment: true`.
5. Static dashboard for visual review.
6. Markdown report for CKBoost submission.
7. Bounded graph pagination for live `graph_nodes` and `graph_channels` collection.
8. Snapshot diff for before/after peer setup, gossip catch-up, and route probing.
9. Public-node presets that generate `connect_peer`, `open_channel`, and follow-up collection commands.
10. Submission brief and reproducible CLI transcript for judges.

## Demo Script

1. Run `npm run verify`.
2. Show `fiber-scope inspect --snapshot fixtures/unbalanced-route-failure.json`.
3. Open the dashboard and show the same finding set.
4. Show Snapshot Diff from fresh-node to route-probed node.
5. Show Public Node Presets and generate a testnet bootstrap runbook.
6. Export a report and diff.
7. Open the CLI transcript and submission brief.
8. Explain the generated circular rebalance dry-run payload.
9. Optional: run `collect` against a local FNN node.

## Submission Checklist

- Public GitHub repo.
- README with install, CLI, dashboard, and demo flow.
- Demo video or screenshots.
- Generated report from `fixtures/unbalanced-route-failure.json` at `docs/demo-report.md`.
- Clear track mapping: Diagnostics & Visualization, Routing & Liquidity, SDKs & Developer Tools.

## Stretch Ideas

- Snapshot diff: before/after connecting to public nodes.
- Route fee budget simulator.
- WSS readiness checks for browser nodes.
- Public-node preset command using Fiber docs pubkeys.
- Watchtower readiness panel.

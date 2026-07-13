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
11. Dashboard Live RPC Lab backed by a local `/api/collect` proxy.
12. Payment-readiness gate for CLI automation and dashboard review.
13. Review-only operator runbook with safety classes, exact Fiber RPC payloads, and success criteria.
14. Topology-led operator console that maps captured Fiber graph evidence to the payment target and runbook.

## Demo Script

1. Run `npm run verify`.
2. Show `fiber-scope inspect --snapshot fixtures/unbalanced-route-failure.json`.
3. Open the dashboard and show the same finding set.
4. Show Snapshot Diff from fresh-node to route-probed node.
5. Show Public Node Presets and generate a testnet bootstrap runbook.
6. Show the Live RPC Lab and the generated `collect` command.
7. Run `fiber-scope gate` against the healthy route-ready fixture.
8. Open Operator Runbook and select the reduced-payment and circular-rebalance dry-run steps.
9. Generate a fresh-node runbook with `--bootstrap-node fiber-testnet-public-bottle` to show approval-gated peer and channel actions.
10. Export a report, runbook, and diff.
11. Open the CLI transcript and submission brief.
12. Optional: run `collect` against a local FNN node.

## Submission Checklist

- Public GitHub repo.
- README with install, CLI, dashboard, and demo flow.
- Demo video or screenshots.
- Generated report from `fixtures/unbalanced-route-failure.json` at `docs/demo-report.md`.
- Clear track mapping: Diagnostics & Visualization, Routing & Liquidity, SDKs & Developer Tools.

## Stretch Ideas

- Route fee budget simulator.
- WSS readiness checks for browser nodes.
- Watchtower readiness panel.
- Confirmed route rehearsal using a local multi-node Fiber devnet.

# FiberScope Submission

## Entry

| Field | Value |
| --- | --- |
| Project | FiberScope |
| Category | **Node, Routing, Cross-Chain, and Diagnostics Infrastructure** |
| Team | FrancisSix, solo |
| Repository | https://github.com/FrancisSix/fiber-scope |
| Hosted demo | https://francissix.github.io/fiber-scope/ |
| Demo video | Pending recording and upload |
| License | MIT |

## Summary

FiberScope is a diagnostic console for Fiber Network operators. It collects FNN JSON-RPC state and turns it into route-readiness findings, an automation gate, a before/after diff, and an ordered remediation runbook.

The hosted build defaults to a sanitized replay captured from Fiber's documented public FNN node and also includes deterministic failure scenarios. Running the project locally enables fresh collection from an operator-selected FNN endpoint through the same analyzer.

## Gap

Fiber exposes the required primitives, but failed payments still require manual correlation across node state, peers, channels, graph visibility, liquidity, route dry runs, and Biscuit authorization. Existing RPC output identifies state; it does not produce a prioritized diagnosis or a safety-labeled recovery plan.

FiberScope closes that operational gap without taking custody of funds or executing remediation.

## Working Implementation

- FNN collector for `node_info`, `list_peers`, `list_channels`, `graph_nodes`, and `graph_channels`.
- Bounded cursor pagination using Fiber's hex-encoded RPC integer schema.
- Sanitized real-node replay with capture provenance, observed counts, and pagination status.
- One-click scenarios for real capture, route failure, route readiness, fresh node, and Biscuit scope failure.
- Optional `send_payment` dry-run evidence for target and circular self-payment probes.
- Stable findings with severity, evidence, and recommended action.
- Strict readiness gate with machine-usable exit status.
- Finding-driven runbook with exact RPC payloads, safety class, approval policy, and success condition.
- Responsive topology console, snapshot upload, report export, and before/after comparison.
- Public-node bootstrap presets based on Fiber's documented node data.
- 26 automated tests plus a static production build.

## Execution Boundary

| Mode | What works | Boundary |
| --- | --- | --- |
| Hosted demo | sanitized real replay, deterministic scenarios, topology, gate, runbook, diff, uploads, exports | no RPC proxy is deployed |
| Local dashboard | all hosted features plus live FNN collection | server binds to `127.0.0.1` |
| CLI | collection, inspect, gate, diff, presets, reports, runbooks | writes files only |
| Remediation | exact reviewable RPC/CLI actions | never executed automatically |
| Payment probe | `send_payment` with `dry_run: true` | never sends value |

## Technical Breakdown

The project is dependency-free Node.js and browser JavaScript:

- `src/rpc.js`: FNN JSON-RPC collection and graph pagination.
- `src/replay.js`: deterministic redaction and bounded replay packaging.
- `src/core.js`: normalization, findings, readiness gate, diff, and runbook model.
- `src/presets.js`: documented public-node presets and bootstrap payloads.
- `src/cli.js`: command interface and Markdown outputs.
- `public/app.js`: browser renderer using the same core model.
- `scripts/serve.js`: loopback-only local dashboard and collector proxy.
- `scripts/capture-replay.js`: explicit network capture and sanitization command.
- `scripts/build-static.js`: static GitHub Pages artifact with replay and fixtures.

Architecture and commands are documented in [README.md](README.md). Security boundaries are documented in [SECURITY.md](SECURITY.md).

## Evidence

- [Judge test flow and screenshots](docs/JUDGE_TEST_FLOW.md)
- [Live public-node validation](docs/LIVE_VALIDATION.md)
- [Real-node diagnostic report](docs/real-node-report.md)
- [CLI transcript](docs/demo-transcript.md)
- [Diagnostic report](docs/demo-report.md)
- [Operator runbook](docs/demo-runbook.md)
- [Snapshot diff](docs/demo-diff.md)
- [Desktop UI](docs/ui-desktop.png)
- [Mobile UI](docs/ui-mobile.png)

Reviewer verification:

```bash
npm run verify
npm run dashboard
```

## Roadmap

1. Validate against a controlled multi-node Fiber devnet and preserve versioned compatibility fixtures.
2. Add local snapshot history and trend alerts.
3. Add approval-gated remediation execution with policy and audit logging.
4. Add fee-budget and route-candidate comparison using upstream Fiber routing primitives.

## AI Disclosure

AI assistance was used for implementation and documentation. Protocol behavior was checked against the Fiber source and RPC documentation, covered by automated tests, exercised in the browser, and validated through read-only collection from the documented public Fiber node. Product scope, safety boundaries, and final verification remained human-directed.

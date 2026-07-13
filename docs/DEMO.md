# Demo Runbook

Target length: 2 minutes.

## Setup

```bash
npm run verify
npm run dashboard
```

Open `http://127.0.0.1:4173/` at 1440 x 900.

## Recording

| Time | Action | Point |
| --- | --- | --- |
| 0:00 | Show route topology and readiness score | One view correlates node, graph, route, and liquidity state. |
| 0:15 | Open the highest-severity finding | Findings have stable IDs, evidence, and operator action. |
| 0:30 | Select runbook steps | Each step has an exact payload, safety class, approval rule, and success condition. |
| 0:55 | Show readiness gate | The same diagnosis is consumable by automation. |
| 1:10 | Show before/after diff | Operators can prove progress after peer, channel, or gossip changes. |
| 1:25 | Open Connect RPC | Local mode collects from a real FNN endpoint; credentials stay in memory. |
| 1:40 | Run the healthy fixture gate in the terminal | `npm run fiber-scope -- gate --snapshot fixtures/healthy-ready.json` exits successfully. |
| 1:55 | End on repository and hosted demo URLs | State that remediation is review-only and payment probes are dry-run only. |

## Required Capture

- Dashboard interaction, not slides.
- One terminal command with visible exit result.
- Hosted demo URL and public repository URL.
- Clear statement that the hosted demo uses fixtures and local mode supports live RPC.

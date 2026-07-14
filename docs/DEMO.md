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
| 0:00 | Show the default real FNN replay | Point out capture time, FNN version, sanitization, source, and bounded graph evidence. |
| 0:20 | Switch to Fixture / route blocked | Show deterministic reproduction of a failed route. |
| 0:35 | Open the highest-severity finding | Findings have stable IDs, evidence, and operator action. |
| 0:50 | Select runbook steps | Each step has an exact payload, safety class, approval rule, and success condition. |
| 1:10 | Show readiness gate and before/after diff | The same diagnosis supports automation and progress evidence. |
| 1:25 | Open Connect RPC | Local mode collects from a real FNN endpoint; credentials stay in memory. |
| 1:40 | Run the healthy fixture gate in the terminal | `npm run fiber-scope -- gate --snapshot fixtures/healthy-ready.json` exits successfully. |
| 1:55 | End on repository and hosted demo URLs | State that remediation is review-only and payment probes are dry-run only. |

## Required Capture

- Dashboard interaction, not slides.
- One terminal command with visible exit result.
- Hosted demo URL and public repository URL.
- Clear statement that the hosted demo includes a sanitized real capture and deterministic fixtures; local mode supports fresh RPC collection.

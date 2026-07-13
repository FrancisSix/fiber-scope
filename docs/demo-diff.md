# FiberScope Snapshot Diff

- Verdict: **improved**
- Score: **52/100 -> 82/100** (+30)
- Status: **blocked -> degraded**
- Route: **not_captured -> failed**

## Metrics

| Metric | Before | After | Delta |
| --- | --- | --- | --- |
| Peers | 0 | 2 | +2 |
| Ready channels | 0 | 2 | +2 |
| Total channels | 0 | 2 | +2 |
| Graph nodes | 0 | 3 | +3 |
| Graph channels | 0 | 2 | +2 |
| Outbound capacity | 0 CKB | 940 CKB | +940 CKB |
| Inbound capacity | 0 CKB | 860 CKB | +860 CKB |

## Findings

| Type | Fingerprint | Finding |
| --- | --- | --- |
| resolved | `FS-CHANNEL-NONE-001` | Node has no payment channels |
| resolved | `FS-PEER-NONE-001` | Node has no connected Fiber peers |
| resolved | `FS-ROUTE-DRYRUN-MISSING-001` | No route dry run was captured |
| introduced | `FS-LIQUIDITY-OUTBOUND-LOW-001` | Outbound liquidity is thin on ready channels |
| introduced | `FS-ROUTE-DRYRUN-FAILED-001` | Route dry run failed |
| introduced | `FS-REBALANCE-CANDIDATE-001` | Circular rebalance candidate found |

## Channel Changes

| Peer | State | Local Delta | Remote Delta |
| --- | --- | --- | --- |
| 03bbbbbb...bbbbbb | added | +900 CKB | +100 CKB |
| 02cccccc...cccccc | added | +40 CKB | +760 CKB |
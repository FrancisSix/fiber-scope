# Live FNN Validation

## Target

| Field | Value |
| --- | --- |
| Timestamp | 2026-07-14T00:07:22Z |
| Endpoint | `http://18.163.221.211:8227` |
| Source | Fiber `docs/public-nodes.md`, node 2 |
| Node | `CkbaNode-2` |
| FNN version | `0.9.0-rc7` |
| FNN commit | `bc361aa`, 2026-07-02 |

## Command

```bash
npm run capture:replay -- \
  --rpc http://18.163.221.211:8227 \
  --graph-limit 100 \
  --graph-pages 1
```

The command used read-only collection. No target, amount, or self-rebalance option was supplied, so no payment RPC was called. It wrote the sanitized replay to `fixtures/real-public-node-replay.json`.

## Observed Result

| Evidence | Value |
| --- | ---: |
| Connected peers | 5 |
| Node-reported channels | 89 |
| Listed channel records | 375 |
| Included non-closed records | 89 |
| Excluded closed records | 286 |
| Ready channel records | 74 |
| Graph nodes collected | 100, bounded and truncated |
| Graph channels collected | 100, bounded and truncated |
| FiberScope status | `DEGRADED`, 73/100 |

The analyzer identified failed and pending channel records, thin outbound liquidity on ready channels, and missing route dry-run evidence. The first validation attempt also caught an RPC compatibility defect: `graph_nodes.limit` and `graph_channels.limit` must be hex-encoded integers. FiberScope now encodes those values and asserts the payload shape in `test/rpc.test.js`.

The committed replay preserves operational evidence while removing peer and graph addresses, pseudonymizing counterparty and transaction identifiers, excluding closed channel records, and clearing pending TLC details. The raw snapshot remains excluded from Git.

Generated analyzer output: [real-node-report.md](real-node-report.md).

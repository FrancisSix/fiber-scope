# Live FNN Validation

## Target

| Field | Value |
| --- | --- |
| Timestamp | 2026-07-13T23:11:20Z |
| Endpoint | `http://18.163.221.211:8227` |
| Source | Fiber `docs/public-nodes.md`, node 2 |
| Node | `CkbaNode-2` |
| FNN version | `0.9.0-rc7` |
| FNN commit | `bc361aa`, 2026-07-02 |

## Command

```bash
node src/cli.js collect \
  --rpc http://18.163.221.211:8227 \
  --out snapshots/public-node-validation.json \
  --graph-limit 100 \
  --graph-pages 1
```

The command used read-only collection. No target, amount, or self-rebalance option was supplied, so no payment RPC was called.

## Observed Result

| Evidence | Value |
| --- | ---: |
| Connected peers | 4 |
| Node-reported channels | 89 |
| Listed channel records | 375 |
| Ready channel records | 74 |
| Graph nodes collected | 100, bounded and truncated |
| Graph channels collected | 100, bounded and truncated |
| FiberScope status | `DEGRADED`, 73/100 |

The analyzer identified failed and pending channel records, thin outbound liquidity on ready channels, and missing route dry-run evidence. The first validation attempt also caught an RPC compatibility defect: `graph_nodes.limit` and `graph_channels.limit` must be hex-encoded integers. FiberScope now encodes those values and asserts the payload shape in `test/rpc.test.js`.

The raw snapshot is excluded from Git because live node state is mutable. Re-run the command to reproduce collection against the currently documented endpoint.

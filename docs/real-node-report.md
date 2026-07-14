# FiberScope Diagnostic Report

- Status: **degraded**
- Score: **73/100**
- Source: `replay:fiber-docs-public-node-2`
- Captured: `2026-07-14T00:07:22.197Z`
- Evidence: **Real FNN replay**, sanitized, bounded
- Provenance: `nervos/fiber/docs/public-nodes.md`

## Node Snapshot

| Metric | Value |
| --- | --- |
| Node | CkbaNode-2 |
| Version | 0.9.0-rc7 |
| Pubkey | `0291a6576bd5a94bd74b27080a48340875338fff9f6d6361fe6b8db8d0d1912fcc` |
| Peers | 5 |
| Ready channels | 74/89 |
| Graph nodes/channels | 100/100 |
| Outbound capacity | 262564.29758583 CKB |
| Inbound capacity | 307023.70241417 CKB |

## Findings

| Severity | Fingerprint | Finding | Evidence | Next action |
| --- | --- | --- | --- | --- |
| warning | `FS-CHANNEL-FAILED-001` | Channel opening failures are present | 020911b8...fb4649: Peer disconnected during channel opening; 02e979b8...30487a: Peer disconnected during channel opening; 02f9dbfb...5f6b9e: Peer disconnected during channel opening; 02f5cef5...8aaf64: Peer disconnected during channel opening; 02312da1...822d82: Peer disconnected during channel opening; 02de127f...dd8a33: Peer disconnected during channel opening; 02a8ce52...3343bf: Peer disconnected during channel opening; 0252fa67...878c4d: Peer disconnected during channel opening; 02b50224...81c2d0: Peer disconnected during channel opening; 025bb66c...b90679: Peer disconnected during channel opening; 02d25f95...dcb95a: Peer disconnected during channel opening | Fix the failure_detail cause before retrying the same peer or funding amount. |
| warning | `FS-CHANNEL-PENDING-001` | Some channels are still opening | 020911b8...fb4649 AwaitingChannelReady local=151 CKB remote=901 CKB; 02e979b8...30487a AwaitingChannelReady local=151 CKB remote=901 CKB; 02f9dbfb...5f6b9e AwaitingChannelReady local=151 CKB remote=901 CKB; 02f5cef5...8aaf64 AwaitingChannelReady local=151 CKB remote=901 CKB; 02312da1...822d82 AwaitingChannelReady local=151 CKB remote=901 CKB | Wait for ChannelReady, or inspect failed pending channels with include_closed and only_pending. |
| warning | `FS-LIQUIDITY-OUTBOUND-LOW-001` | Outbound liquidity is thin on ready channels | 023fe261...b1c580 local=151 CKB (14%); 0289a99d...7dc4d7 local=151 CKB (14%); 02d14121...e1426e local=151 CKB (14%); 0274326f...6b4658 local=151 CKB (14%); 024ceb08...abab7a local=151 CKB (14%) | Try a smaller dry-run amount, open an additional funded channel, or rebalance from an outbound-heavy channel. |
| info | `FS-ROUTE-DRYRUN-MISSING-001` | No route dry run was captured | Snapshot does not include send_payment dry_run or build_router output. | Run send_payment with dry_run: true before executing the actual payment. |

## RPC Coverage

| Method | Status | Diagnostic scope |
| --- | --- | --- |
| `node_info` | ok | `read("node")` |
| `list_peers` | ok | `read("peers")` |
| `list_channels` | ok | `read("channels")` |
| `graph_nodes` | ok | `read("graph")` |
| `graph_channels` | ok | `read("graph")` |
| `build_router` | missing | `read("payments")` |
| `send_payment_dry_run` | missing | `write("payments") for dry-run send_payment` |

## Source Notes

- Fiber rebalancing uses self-payments with `allow_self_payment: true` and should be tested with `dry_run: true` first.
- Fiber gossip exposes public topology, not real-time channel balances, so route success still depends on local and remote liquidity.
- Fiber v0.8 RPCs use pubkeys instead of peer IDs for peer and channel operations.
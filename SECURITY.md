# Security

## Scope

FiberScope is a diagnostic and planning tool. It does not execute generated remediation, open channels, update channel policy, or send payments.

## Runtime Boundary

- The hosted GitHub Pages build is static and has no collector API.
- `npm run dashboard` binds the collector proxy to `127.0.0.1`.
- The local operator chooses the FNN RPC destination. Do not expose the dashboard server to untrusted networks.
- RPC request bodies are limited to 64 KiB. Graph page size and page count are bounded.

## Credentials

- Biscuit tokens are accepted only for the current collection request.
- Tokens are not included in snapshots, reports, runbooks, command previews, or logs.
- The browser password field disables autocomplete.

## State-Changing Operations

- Collection RPCs are read-only by default.
- Payment and rebalance probes set `dry_run: true`.
- Generated `connect_peer`, `open_channel`, and `update_channel` steps are review-only and marked with approval and safety metadata.

## Reporting

Report security issues through a private security advisory on the GitHub repository. Do not include live Biscuit tokens, private keys, or unredacted production snapshots.

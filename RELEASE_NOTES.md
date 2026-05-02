# hive-mcp-wallet v1.0.0 — initial release

Public MCP server for **HiveWallet** — the agent-native wallet primitive where the DID is the account holder.

## What ships

- **5 MCP tools** wrapping the HiveWallet facade: `wallet_info`, `wallet_provision`, `wallet_transfer`, `wallet_verify`, `wallet_chain`
- **MCP 2024-11-05** Streamable-HTTP / JSON-RPC 2.0
- Endpoint: `https://hive-mcp-wallet.onrender.com/mcp`
- Smithery manifest, agent-card, AP2 manifest, SEO landing — all wired

## Backend

- Facade: [`hive-wallet.onrender.com`](https://hive-wallet.onrender.com)
- Settlement: [`hivebank.onrender.com`](https://hivebank.onrender.com) — Ed25519 receipt signer, CTEF chain, SHOD layer gate
- Verifier public key published at `/info` as `verifier_pk_b64u`

## HiveDNA receipts

Every transfer mints a 3-proof receipt:

- **SHOD** Sovereign Holographic Object Descriptor — rejection layers can't mint
- **Spectral-ZK** verified epoch-scoped ticket
- **CTEF** content-addressed chain entry, race-safe append
- **Ed25519** signed canonical body (byte-exact verify)
- Score 0-1000 deterministic over proofs + regime + chain depth

The signing key is a session key. The long-lived identity key in HSM only signs the session-key cert at session start. Receipts are verifiable offline by anyone with the receipt and the published public key — operator-independent.

## Real rails only

USDC on Base — asset address `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, treasury `0x15184Bf50B3d3F52b60434f8942b7D52F2eB436E`.

## Brand

Hive Civilization gold `#FFB800`.

## License

MIT.

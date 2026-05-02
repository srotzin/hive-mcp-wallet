# hive-mcp-wallet

> The first wallet where the agent IS the account holder.

Public MCP server for **HiveWallet** — the agent-native wallet primitive in the Hive Civilization stack. Tools provision DID-as-holder wallets, transfer USDC, mint **HiveDNA 3-proof receipts** (SHOD + spectral-ZK + CTEF, Ed25519-signed), and verify receipts or whole chains offline. Real rails — USDC on Base — no mocks.

- **Endpoint:** `https://hive-mcp-wallet.onrender.com/mcp`
- **Transport:** Streamable-HTTP (MCP 2024-11-05)
- **Backend:** [`hive-wallet.onrender.com`](https://hive-wallet.onrender.com) → [`hivebank.onrender.com`](https://hivebank.onrender.com)
- **Treasury:** `0x15184Bf50B3d3F52b60434f8942b7D52F2eB436E`

## Tools

| Tool | Description |
|---|---|
| `wallet_info` | Verifier public key, supported proofs, backend versions. Free. |
| `wallet_provision` | Create a fresh agent-DID wallet. The DID is the account holder. |
| `wallet_transfer` | Move USDC between DIDs, mint a HiveDNA 3-proof receipt. |
| `wallet_verify` | Public verify of a receipt — Ed25519 sig + body hash + CTEF recompute. |
| `wallet_chain` | Walk a DID's full receipt chain, return signed integrity statement. |

## Why HiveDNA receipts

The receipt is a separate, signed artifact (not just a transaction log entry):

- **SHOD** — Sovereign Holographic Object Descriptor layers; rejection layers cannot mint receipts
- **Spectral-ZK** — verified zero-knowledge ticket scoped to the epoch
- **CTEF chain** — content-addressed, race-safe append; chain root walks deterministically
- **Ed25519** signed canonical body with `verify_url` published in the response
- **Score 0-1000** — deterministic from proofs, regime, chain depth

Public key travels with the receipt. A regulator with the receipt and the published key can verify offline without trusting the operator.

## Endpoints behind the tools

| Tool | Backend route |
|---|---|
| `wallet_info` | `GET /info` (`https://hive-wallet.onrender.com`) |
| `wallet_provision` | `POST /provision` |
| `wallet_transfer` | `POST /transfer` |
| `wallet_verify` | `GET /verify/:receipt_id` (no auth, public) |
| `wallet_chain` | `GET /chain/:did` (no auth, public) |

## Connect

### Claude Desktop

```json
{
  "mcpServers": {
    "hive-wallet": {
      "transport": "streamable-http",
      "url": "https://hive-mcp-wallet.onrender.com/mcp"
    }
  }
}
```

### Inspector / curl

```bash
curl -s -X POST https://hive-mcp-wallet.onrender.com/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Run locally

```bash
npm install
PORT=3000 node server.js
```

## Configuration

| Env | Default |
|---|---|
| `PORT` | `3000` |
| `HIVE_WALLET_URL` | `https://hive-wallet.onrender.com` |
| `HIVEBANK_URL` | `https://hivebank.onrender.com` |

## License

MIT

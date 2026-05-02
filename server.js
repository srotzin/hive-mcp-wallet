#!/usr/bin/env node
/**
 * HiveWallet MCP Server
 * Public surface for the agent-native wallet primitive.
 *
 * Backend : https://hive-wallet.onrender.com (facade) -> https://hivebank.onrender.com
 * Spec    : MCP 2024-11-05 / Streamable-HTTP / JSON-RPC 2.0
 * Brand   : Hive Civilization gold #FFB800
 *
 * RAILS RULE 1 — REAL RAILS ONLY. NO MOCK RESPONSES.
 * Every tool proxies to the live HiveWallet facade which mints real
 * Ed25519-signed HiveDNA receipts on the HiveBank settlement layer.
 */

import express from 'express';
import { renderLanding, renderRobots, renderSitemap, renderSecurity, renderOgImage, seoJson } from './meta.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

// ─── CORS (permissive on read-only / discovery surface) ─────────────────────
// Browser callers (e.g. thehiveryiq.com live demo) need to hit /mcp directly.
// The free tools (wallet_info, wallet_verify, wallet_chain) carry no secrets;
// the paid tools (wallet_provision, wallet_transfer) still gate on x402.
// Origin is wide-open by design — there is no cookie-bearing surface here.
app.use((req, res, next) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, accept, x-payment');
  res.setHeader('access-control-max-age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

const PORT     = process.env.PORT     || 3000;
const FACADE   = process.env.HIVE_WALLET_URL || 'https://hive-wallet.onrender.com';
const HIVEBANK = process.env.HIVEBANK_URL    || 'https://hivebank.onrender.com';

const VERSION = '1.1.1';
const TREASURY  = '0x15184Bf50B3d3F52b60434f8942b7D52F2eB436E';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ─── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'wallet_info',
    description: 'Return HiveWallet metadata: facade version, backend version, HiveDNA verifier public key (b64u), supported proofs (SHOD, SPECTRAL_ZK, CTEF), verify endpoint, and chain endpoint. No payment required — free discovery call.',
    inputSchema: { type: 'object', required: [], properties: {} },
  },
  {
    name: 'wallet_provision',
    description: 'Create a fresh agent-DID wallet. The DID is the account holder — there is no human owner. Returns the new DID, an initial chain root, and signing-key cert metadata. Proxies to the live HiveWallet facade.',
    inputSchema: {
      type: 'object',
      required: [],
      properties: {
        hint:  { type: 'string', description: 'Optional human-readable label for the wallet (does not appear on-chain)' },
        owner: { type: 'string', description: 'Optional DID of a parent / operator agent — recorded in the cert chain only' },
      },
    },
  },
  {
    name: 'wallet_transfer',
    description: 'Move USDC between two agent DIDs. Mints a HiveDNA 3-proof receipt (SHOD layers + spectral-ZK ticket + CTEF chain entry, Ed25519-signed canonical body, score 0-1000) and returns the receipt id, score, proofs, signature, verifier_pk_b64u, and verify_url. Real settlement on HiveBank.',
    inputSchema: {
      type: 'object',
      required: ['from_did', 'to_did', 'amount_usdc'],
      properties: {
        from_did:    { type: 'string', description: 'Source agent DID (must control signing key — provisioned via wallet_provision)' },
        to_did:      { type: 'string', description: 'Destination agent DID' },
        amount_usdc: { type: 'number', description: 'Amount in USDC (USDC on Base, asset address 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)' },
        memo:        { type: 'string', description: 'Optional memo string (recorded in receipt claims, not on-chain)' },
      },
    },
  },
  {
    name: 'wallet_verify',
    description: 'Verify a HiveDNA receipt by id. Public, no auth. Re-runs Ed25519 signature verification, body-hash recompute, and CTEF chain-entry recompute against the canonical body. Returns found, verified, score, proofs, and the signing public key. This is the regulator-grade primitive — anyone with the receipt and the verifier public key can validate offline.',
    inputSchema: {
      type: 'object',
      required: ['receipt_id'],
      properties: {
        receipt_id: { type: 'string', description: 'HiveDNA receipt identifier (rcpt_<base32>)' },
      },
    },
  },
  {
    name: 'wallet_chain',
    description: 'Walk the full receipt chain for a DID and return a signed integrity statement. Public, no auth. Returns chain length, chain root (deterministic over the chain hash), latest entry hash, intactness flag, and a signed root statement. Useful as a contract test for any external verifier integrating with HiveWallet.',
    inputSchema: {
      type: 'object',
      required: ['did'],
      properties: {
        did: { type: 'string', description: 'Agent DID whose chain should be walked (e.g. did:hive:agent:abc123)' },
      },
    },
  },
];

// ─── Proxy helper ────────────────────────────────────────────────────────────
async function proxyJson(method, baseUrl, path, { body, headers } = {}) {
  const init = {
    method,
    headers: { 'content-type': 'application/json', 'user-agent': `hive-mcp-wallet/${VERSION}`, ...(headers || {}) },
    signal: AbortSignal.timeout(15000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const resp = await fetch(`${baseUrl}${path}`, init);
  let data = null; try { data = await resp.json(); } catch { data = null; }
  return { status: resp.status, data: data ?? {} };
}

// ─── Tool dispatcher ────────────────────────────────────────────────────────
async function dispatchTool(name, args, id) {
  const wrap = (data, http) => ({
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: JSON.stringify({ http_status: http, ...data }, null, 2) }] },
  });
  const errArg = (msg) => ({ jsonrpc: '2.0', id, error: { code: -32602, message: msg } });
  const errInt = (msg) => ({ jsonrpc: '2.0', id, error: { code: -32000, message: `Proxy error: ${msg}` } });
  try {
    switch (name) {
      case 'wallet_info': {
        const r = await proxyJson('GET', FACADE, '/info');
        return wrap(r.data, r.status);
      }
      case 'wallet_provision': {
        const { hint, owner } = args || {};
        const r = await proxyJson('POST', FACADE, '/provision', { body: { hint, owner } });
        return wrap(r.data, r.status);
      }
      case 'wallet_transfer': {
        const { from_did, to_did, amount_usdc, memo } = args || {};
        if (!from_did) return errArg('from_did is required');
        if (!to_did) return errArg('to_did is required');
        const amt = Number(amount_usdc);
        if (!Number.isFinite(amt) || amt <= 0) return errArg('amount_usdc must be a positive number');
        const r = await proxyJson('POST', FACADE, '/transfer', { body: { from_did, to_did, amount_usdc: amt, memo } });
        return wrap(r.data, r.status);
      }
      case 'wallet_verify': {
        const { receipt_id } = args || {};
        if (!receipt_id) return errArg('receipt_id is required');
        if (!/^[A-Za-z0-9_\-:]+$/.test(receipt_id)) return errArg('invalid receipt_id format');
        const r = await proxyJson('GET', FACADE, `/verify/${encodeURIComponent(receipt_id)}`);
        return wrap(r.data, r.status);
      }
      case 'wallet_chain': {
        const { did } = args || {};
        if (!did) return errArg('did is required');
        const r = await proxyJson('GET', FACADE, `/chain/${encodeURIComponent(did)}`);
        return wrap(r.data, r.status);
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Tool not found: ${name}` } };
    }
  } catch (err) {
    return errInt(err.message);
  }
}

// ─── MCP JSON-RPC handler ────────────────────────────────────────────────────
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};
  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC' } });
  }
  try {
    switch (method) {
      case 'initialize':
        return res.json({ jsonrpc: '2.0', id, result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name:    'hive-mcp-wallet',
            version: VERSION,
            description: 'Public MCP surface for HiveWallet — the agent-native wallet primitive (provision / transfer / verify / chain) with HiveDNA 3-proof receipts.',
          },
        } });
      case 'tools/list':
        return res.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call': {
        const { name, arguments: args } = params || {};
        const out = await dispatchTool(name, args, id);
        return res.json(out);
      }
      case 'ping':
        return res.json({ jsonrpc: '2.0', id, result: {} });
      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

// ─── Discovery + health ─────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status:    'ok',
  service:   'hive-mcp-wallet',
  version:   VERSION,
  backends:  { facade: FACADE, settlement: HIVEBANK },
  toolCount: TOOLS.length,
  treasury:  TREASURY,
  brand:     '#FFB800',
}));

app.get('/.well-known/mcp.json', (_req, res) => res.json({
  name:      'hive-mcp-wallet',
  endpoint:  '/mcp',
  transport: 'streamable-http',
  protocol:  '2024-11-05',
  tools:     TOOLS.map(t => ({ name: t.name, description: t.description })),
}));

// ─── Agent card + AP2 ───────────────────────────────────────────────────────
const SERVICE = 'hive-mcp-wallet';
const AGENT_CARD = {
  name: SERVICE,
  description: 'MCP server — agent-native wallet primitive. Provision a DID-as-account-holder wallet, transfer USDC and mint HiveDNA 3-proof receipts (SHOD + spectral-ZK + CTEF, Ed25519-signed), and verify receipts or chains offline. Real rails only. USDC on Base.',
  url: `https://${SERVICE}.onrender.com`,
  provider: { organization: 'Hive Civilization', url: 'https://www.thehiveryiq.com', contact: 'steve@thehiveryiq.com' },
  version: VERSION,
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  authentication: {
    schemes: ['x402'],
    credentials: {
      x402: { type: 'x402', asset: 'USDC', network: 'base', asset_address: BASE_USDC, recipient: TREASURY },
    },
  },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  skills: TOOLS.map(t => ({ name: t.name, description: t.description })),
  extensions: { hive_pricing: { currency: 'USDC', model: 'per_call', rails: ['x402'] } },
};

const AP2 = {
  ap2_version: '1',
  agent: { name: SERVICE, did: `did:web:${SERVICE}.onrender.com`, description: AGENT_CARD.description },
  endpoints: { mcp: `https://${SERVICE}.onrender.com/mcp`, agent_card: `https://${SERVICE}.onrender.com/.well-known/agent-card.json` },
  payments: {
    schemes: ['x402'],
    primary: { scheme: 'x402', network: 'base', asset: 'USDC', asset_address: BASE_USDC, recipient: TREASURY },
  },
  brand: { color: '#FFB800', name: 'Hive Civilization' },
};

app.get('/.well-known/agent-card.json', (_req, res) => res.json(AGENT_CARD));
app.get('/.well-known/ap2.json',        (_req, res) => res.json(AP2));

// ─── SEO / Landing ──────────────────────────────────────────────────────────
const SERVICE_CFG = {
  service:    SERVICE,
  shortName:  'HiveWallet',
  title:      'HiveWallet · Agent-Native Wallet MCP (HiveDNA 3-proof receipts)',
  tagline:    'The first wallet where the agent IS the account holder.',
  description: 'MCP server for the HiveWallet primitive — provision DID-as-holder wallets, transfer USDC with HiveDNA 3-proof receipts (SHOD + spectral-ZK + CTEF, Ed25519-signed), verify and walk receipt chains. Real rails. USDC on Base.',
  keywords:   ['mcp', 'model-context-protocol', 'wallet', 'agent-wallet', 'hivedna', 'hivewallet', 'agentic', 'ai-agent', 'hive', 'hive-civilization', 'usdc', 'base', 'a2a', '402', 'ed25519', 'audit'],
  externalUrl: `https://${SERVICE}.onrender.com`,
  gatewayMount: '/wallet',
  version:    VERSION,
  pricing:    [
    { name: 'wallet_info',      priceUsd: 0.0,   label: 'Discovery (free)' },
    { name: 'wallet_provision', priceUsd: 0.05,  label: 'Provision wallet (Tier 3)' },
    { name: 'wallet_transfer',  priceUsd: 0.01,  label: 'Transfer + receipt mint (Tier 2)' },
    { name: 'wallet_verify',    priceUsd: 0.0,   label: 'Verify receipt (free, public)' },
    { name: 'wallet_chain',     priceUsd: 0.0,   label: 'Chain walk (free, public)' },
  ],
};
SERVICE_CFG.tools = TOOLS.map(t => ({ name: t.name, description: t.description }));

app.get('/',        (_req, res) => res.type('text/html; charset=utf-8').send(renderLanding(SERVICE_CFG)));
app.get('/og.svg',  (_req, res) => res.type('image/svg+xml').send(renderOgImage(SERVICE_CFG)));
app.get('/robots.txt', (_req, res) => res.type('text/plain').send(renderRobots(SERVICE_CFG)));
app.get('/sitemap.xml', (_req, res) => res.type('application/xml').send(renderSitemap(SERVICE_CFG)));
app.get('/.well-known/security.txt', (_req, res) => res.type('text/plain').send(renderSecurity()));
app.get('/seo.json', (_req, res) => res.json(seoJson(SERVICE_CFG)));

// ─── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`HiveWallet MCP Server v${VERSION} on :${PORT}`);
  console.log(`  Facade   : ${FACADE}`);
  console.log(`  Settle   : ${HIVEBANK}`);
  console.log(`  Treasury : ${TREASURY}`);
  console.log(`  Tools    : ${TOOLS.length} (${TOOLS.map(t => t.name).join(', ')})`);
  console.log(`  Brand    : #FFB800`);
});

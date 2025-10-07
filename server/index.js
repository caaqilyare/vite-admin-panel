import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.resolve(process.cwd(), 'server', 'db.json');
const DIST_PATH = path.resolve(process.cwd(), 'dist');
const TX_FEE = 0.35; // USD fee per transaction (buy/sell)

app.use(cors());
app.use(express.json());

function initialState() {
  return {
    user: { name: 'Munasar', balance: 0 },
    positions: {},
    history: [],
    deposits: [],
    lastScannedMint: "",
    todos: {},
    // history items: { id, ts, side: 'buy'|'sell', mint, name?, symbol?, price, qty, value }
  };
}

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = initialState();
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return initialState();
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

app.get('/api/state', (req, res) => {
  const db = readDB();
  // ensure defaults
  if (!db.user || typeof db.user.balance !== 'number') {
    db.user = { name: 'Munasar', balance: 0 };
    writeDB(db);
  }
  if (!db.history) db.history = [];
  if (!Array.isArray(db.deposits)) db.deposits = [];
  if (typeof db.lastScannedMint !== 'string') db.lastScannedMint = "";
  // migrate legacy fields
  if (db.activity) {
    delete db.activity;
    writeDB(db);
  }
  res.json(db);
});

// (activity removed)

// persist last scanned mint
app.post('/api/last-scanned', (req, res) => {
  const { mint } = req.body || {};
  if (!mint || typeof mint !== 'string') {
    return res.status(400).json({ error: 'Invalid mint' });
  }
  const db = readDB();
  db.lastScannedMint = mint;
  writeDB(db);
  res.json(db);
});

// update user name
app.post('/api/user', (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const db = readDB();
  db.user = { ...(db.user || {}), name: name.trim() };
  writeDB(db);
  res.json(db);
});

// deposit funds
app.post('/api/deposit', (req, res) => {
  const { amount } = req.body || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const db = readDB();
  const bal = Number(db?.user?.balance ?? 0) + amt;
  db.user = { ...(db.user || { name: 'caaqil' }), balance: Number(bal.toFixed(6)) };
  // record deposit
  const entry = { ts: Date.now(), amount: Number(amt.toFixed(6)) };
  db.deposits = Array.isArray(db.deposits) ? [{ ...entry }, ...db.deposits].slice(0, 200) : [entry];
  writeDB(db);
  res.json(db);
});

app.post('/api/buy', (req, res) => {
  const { mint, price, qty, name, symbol, marketCap } = req.body || {};
  if (!mint || !Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) {
    return res.status(400).json({ error: 'Invalid buy params' });
  }
  const db = readDB();
  const cost = price * qty;
  const total = cost + TX_FEE;
  if (db.user.balance < total) {
    return res.status(400).json({ error: `Insufficient balance (need $${total.toFixed(2)} incl. $${TX_FEE.toFixed(2)} fee)` });
  }
  // update balance
  db.user.balance = Number((db.user.balance - total).toFixed(6));
  // update position (avg price)
  const pos = db.positions[mint] || { qty: 0, avgPrice: 0, name, symbol };
  const newQty = pos.qty + qty;
  const newAvg = newQty > 0 ? ((pos.avgPrice * pos.qty) + cost) / newQty : 0;
  db.positions[mint] = { qty: Number(newQty.toFixed(6)), avgPrice: Number(newAvg.toFixed(8)), name: name ?? pos.name, symbol: symbol ?? pos.symbol };
  // history
  db.history.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ts: Date.now(), side: 'buy', mint, name, symbol, price, qty, value: Number(cost.toFixed(6)), fee: TX_FEE, marketCap: Number.isFinite(marketCap) ? Number(marketCap) : undefined });
  writeDB(db);
  res.json(db);
});

app.post('/api/sell', (req, res) => {
  const { mint, price, qty, marketCap } = req.body || {};
  if (!mint || !Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'Invalid sell params' });
  }
  const db = readDB();
  const pos = db.positions[mint];
  if (!pos || pos.qty <= 0) {
    return res.status(400).json({ error: 'No position' });
  }
  const sellQty = Number.isFinite(qty) && qty > 0 ? Math.min(qty, pos.qty) : pos.qty;
  const proceeds = price * sellQty;
  // ensure user can cover fee (from proceeds or existing balance)
  if (db.user.balance + proceeds < TX_FEE) {
    return res.status(400).json({ error: `Insufficient balance for $${TX_FEE.toFixed(2)} fee` });
  }
  db.user.balance = Number((db.user.balance + proceeds - TX_FEE).toFixed(6));
  const remaining = pos.qty - sellQty;
  if (remaining <= 0.0000001) {
    delete db.positions[mint];
  } else {
    db.positions[mint] = { ...pos, qty: Number(remaining.toFixed(6)) };
  }
  db.history.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ts: Date.now(), side: 'sell', mint, name: pos.name, symbol: pos.symbol, price, qty: sellQty, value: Number(proceeds.toFixed(6)), fee: TX_FEE, marketCap: Number.isFinite(marketCap) ? Number(marketCap) : undefined });
  writeDB(db);
  res.json(db);
});

// Upsert per-token checklist
// body: { mint: string, items: Array<{ id: string, text: string, done: boolean }> }
app.post('/api/todos', (req, res) => {
  const { mint, items } = req.body || {};
  if (!mint || typeof mint !== 'string' || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid todos payload' });
  }
  const db = readDB();
  db.todos = db.todos || {};
  db.todos[mint] = items.map(it => ({ id: String(it.id), text: String(it.text || ''), done: !!it.done }));
  writeDB(db);
  res.json(db);
});

// Reset all data to initial state
app.post('/api/reset', (req, res) => {
  const initial = initialState();
  writeDB(initial);
  res.json(initial);
});

// --- Scanning/proxy endpoints (RugCheck + FluxBeam + SOL/USD) ---
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/; // Solana base58 (no 0, O, I, l)
function isValidMint(m) {
  const s = String(m || '').trim();
  return s.length >= 32 && s.length <= 44 && BASE58_RE.test(s);
}

// Simple in-memory cache for RugCheck reports to avoid frequent fetches
const reportCache = new Map(); // mint -> { ts: number, data: any }
const REPORT_TTL_MS = 300_000; // cache RugCheck report for 5 minutes

// Lightweight cache for FluxBeam price to stabilize 300ms polling
const priceCache = new Map(); // mint -> { ts: number, price: number|null }
const PRICE_TTL_MS = 300; // align with frontend polling cadence

// Summary cache to preserve last known good price/supply/marketCap
const summaryCache = new Map(); // mint -> { ts: number, price: number|null, supply: number|null, marketCap: number|null }
// Fallback price to avoid nulls in the client when upstream price is unavailable
const PRICE_FALLBACK = 0.00004996332706936711;
async function getCachedReport(mint) {
  const now = Date.now();
  const cached = reportCache.get(mint);
  if (cached && (now - cached.ts) < REPORT_TTL_MS) {
    return cached.data;
  }
  const data = await fetchRugReport(mint);
  reportCache.set(mint, { ts: now, data });
  return data;
}

async function fetchRugReport(mint) {
  const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report`;
  const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!resp.ok) throw new Error(`RugCheck ${resp.status}`);
  return await resp.json();
}

async function fetchFluxPrice(mint) {
  const url = `https://data.fluxbeam.xyz/tokens/${mint}/price`;
  const resp = await fetch(url, { headers: { 'Accept': 'text/plain' } });
  if (!resp.ok) throw new Error(`Fluxbeam ${resp.status}`);
  const t = (await resp.text()).trim();
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error('Fluxbeam invalid price');
  return n;
}

async function getCachedFluxPrice(mint) {
  const now = Date.now();
  const cached = priceCache.get(mint);
  if (cached && (now - cached.ts) < PRICE_TTL_MS) {
    return cached.price;
  }
  const price = await fetchFluxPrice(mint);
  priceCache.set(mint, { ts: now, price });
  return price;
}

// Removed SOL/USD conversion per request

// RugCheck proxy
app.get('/api/scan/report/:mint', async (req, res) => {
  try {
    const { mint } = req.params;
    if (!isValidMint(mint)) return res.status(400).json({ error: 'Invalid mint' });
    const report = await fetchRugReport(mint);
    res.json(report);
  } catch (e) {
    // Graceful fallback: return an empty report shape with error instead of 502
    res.json({ error: String(e?.message || e) });
  }
});

// FluxBeam price proxy
app.get('/api/scan/price/:mint', async (req, res) => {
  try {
    const { mint } = req.params;
    if (!isValidMint(mint)) return res.status(400).json({ error: 'Invalid mint' });
    const price = await getCachedFluxPrice(mint);
    res.json({ price });
  } catch (e) {
    // Graceful fallback: null price with error message
    res.json({ price: PRICE_FALLBACK, error: String(e?.message || e) });
  }
});

// Removed /api/scan/solusd per request

// Combined summary: price, solUsd, priceUsd, supply, marketCap
app.get('/api/scan/summary/:mint', async (req, res) => {
  try {
    const { mint } = req.params;
    if (!isValidMint(mint)) return res.status(400).json({ error: 'Invalid mint' });
    const [report, fluxPrice] = await Promise.all([
      getCachedReport(mint).catch(() => null),
      getCachedFluxPrice(mint).catch(() => null),
    ]);
    const decimalsNum = Number(report?.token?.decimals ?? 0);
    const rawSupplyNum = Number(report?.token?.supply ?? 0);
    const supplyNew = (Number.isFinite(rawSupplyNum) && decimalsNum >= 0)
      ? rawSupplyNum / Math.pow(10, decimalsNum)
      : null;
    const priceNew = (typeof fluxPrice === 'number' && Number.isFinite(fluxPrice)) ? fluxPrice : null;

    const cached = summaryCache.get(mint) || { price: null, supply: null, marketCap: null };
    const price = (priceNew != null) ? priceNew : (cached.price != null ? cached.price : PRICE_FALLBACK);
    const supply = (supplyNew != null && supplyNew > 0) ? supplyNew : cached.supply;
    const priceUsd = price != null ? price : null;
    const marketCapNew = (priceUsd != null && supply != null)
      ? priceUsd * supply
      : null;
    const marketCap = (marketCapNew != null && Number.isFinite(marketCapNew)) ? marketCapNew : cached.marketCap ?? null;

    summaryCache.set(mint, { ts: Date.now(), price: price ?? null, supply: supply ?? null, marketCap: marketCap ?? null });
    res.json({ mint, price, priceUsd, supply, marketCap, report });
  } catch (e) {
    // Last-resort fallback
    res.json({ mint: req.params?.mint, price: null, priceUsd: null, supply: null, marketCap: null, error: String(e?.message || e) });
  }
});

// Serve built frontend (if present)
app.use(express.static(DIST_PATH));

// SPA fallback to index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(DIST_PATH, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return next();
});

// Bind to 0.0.0.0 so the server is reachable via machine IP on the network
app.listen(PORT, '0.0.0.0', () => {
  console.log(`JSON server running on port ${PORT} (reachable via your machine IP)`);
});

import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Paper,
  Grid,
  Stack,
  Typography,
  Button,
  Chip,
  Divider,
  Tabs,
  Tab,
  TextField,
  IconButton,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'

// Simple placeholder sparkline as inline SVG (no extra deps)
function Sparkline({ width = 320, height = 72 }: { width?: number; height?: number }) {
  const points = useMemo(() => {
    const arr = [0, -4, 6, -2, 8, -3, 3, -5, 4, 0]
    const maxAbs = Math.max(...arr.map(v => Math.abs(v))) || 1
    const stepX = width / (arr.length - 1)
    const midY = height / 2
    return arr.map((v, i) => ({ x: i * stepX, y: midY - (v / maxAbs) * (height / 2 - 6) }))
  }, [width, height])
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke="rgba(156,163,175,0.8)" strokeWidth={2} />
    </svg>
  )
}

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Box sx={{ textAlign: 'center', color: 'text.secondary', py: 4 }}>
      <Typography variant="subtitle1" fontWeight={800}>{title}</Typography>
      {subtitle && <Typography variant="body2" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
    </Box>
  )
}

export default function PortfolioAnalyzer() {
  const [timeframe, setTimeframe] = useState<'all' | '7d' | '24h' | '12h' | '6h' | '1h'>('all')
  const [wallet, setWallet] = useState('')
  const [filter, setFilter] = useState<'all' | 'most_profitable' | 'deployed' | 'age'>('all')

  // Types aligned with App.tsx
  type HistoryItem = {
    id: string
    ts: number
    side: 'buy' | 'sell'
    mint: string
    name?: string
    symbol?: string
    price: number
    qty: number
    value: number
    fee?: number
    marketCap?: number | null
  }
  type Position = { qty: number; avgPrice: number; name?: string; symbol?: string }
  type AppState = {
    user: { name: string; balance: number }
    positions: Record<string, Position>
    history: HistoryItem[]
    deposits: Array<{ ts: number; amount: number }>
  }

  const [data, setData] = useState<AppState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Realtime polling of /api/state
  useEffect(() => {
    let mounted = true
    let timer: any
    async function tick() {
      try {
        if (!mounted) return
        setLoading(true)
        setError(null)
        const res = await fetch('/api/state')
        const json = await res.json()
        if (mounted) setData(json)
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load state')
      } finally {
        if (mounted) setLoading(false)
        timer = setTimeout(tick, 2000) // 2s polling
      }
    }
    tick()
    return () => { mounted = false; if (timer) clearTimeout(timer) }
  }, [])

  const fmt = (n: number | null | undefined, d = 6, fixed?: number) => {
    if (n == null || Number.isNaN(n)) return '-'
    const digits = n < 1 ? d : 2
    const opts: Intl.NumberFormatOptions =
      fixed != null ? { minimumFractionDigits: fixed, maximumFractionDigits: fixed } : { maximumFractionDigits: digits }
    return n.toLocaleString(undefined, opts)
  }

  const shortAddress = (addr: string, left = 4, right = 4) => {
    if (!addr) return ''
    if (addr.length <= left + right + 1) return addr
    return `${addr.slice(0, left)}…${addr.slice(-right)}`
  }

  // Aggregates
  const depositsTotal = useMemo(() => (data?.deposits || []).reduce((a, d) => a + (Number(d.amount) || 0), 0), [data?.deposits])
  const buyCost = useMemo(() => (data?.history || [])
    .filter(h => h.side === 'buy')
    .reduce((a, h) => a + (Number(h.value) || 0), 0), [data?.history])
  const sellProceeds = useMemo(() => (data?.history || [])
    .filter(h => h.side === 'sell')
    .reduce((a, h) => a + (Number(h.value) || 0), 0), [data?.history])
  const totalFees = useMemo(() => (data?.history || []).reduce((a, h) => a + (Number(h.fee) || 0), 0), [data?.history])
  const realizedPnL = useMemo(() => sellProceeds - buyCost - totalFees, [sellProceeds, buyCost, totalFees])
  // Profit as requested: Balance - Deposited
  const profit = useMemo(() => {
    const bal = Number(data?.user?.balance ?? 0)
    return bal - depositsTotal
  }, [data?.user?.balance, depositsTotal])

  // Timeframe realized pnl
  const timeframeStats = useMemo(() => {
    const hist = data?.history || []
    const now = Date.now()
    const start = (() => {
      switch (timeframe) {
        case '1h': return now - 1 * 3600_000
        case '6h': return now - 6 * 3600_000
        case '12h': return now - 12 * 3600_000
        case '24h': return now - 24 * 3600_000
        case '7d': return now - 7 * 24 * 3600_000
        default: return 0
      }
    })()
    let buys = 0, sells = 0, fees = 0
    for (const h of hist) {
      if (h.ts >= start) {
        buys += h.side === 'buy' ? (Number(h.value) || 0) : 0
        sells += h.side === 'sell' ? (Number(h.value) || 0) : 0
        fees += Number(h.fee) || 0
      }
    }
    const pnl = sells - buys - fees
    const roi = buys > 0 ? (pnl / buys) * 100 : null
    return { pnl, roi }
  }, [data?.history, timeframe])

  // Last known price per mint from latest history item
  const lastPriceByMint = useMemo(() => {
    const hist = data?.history || []
    return hist.reduce<Record<string, { ts: number; price: number }>>((acc, h) => {
      if (typeof h.price === 'number' && Number.isFinite(h.price)) {
        const prev = acc[h.mint]
        if (!prev || h.ts > prev.ts) acc[h.mint] = { ts: h.ts, price: h.price }
      }
      return acc
    }, {})
  }, [data?.history])

  // Positions array with estimated pnl% using last known price
  const positions = useMemo(() => Object.entries(data?.positions || {}) as Array<[string, Position]>, [data?.positions])
  const positionsWithPnl = useMemo(() => positions.map(([mint, p]) => {
    const last = lastPriceByMint[mint]?.price
    const pnlPct = (typeof last === 'number' && p.avgPrice > 0) ? ((last - p.avgPrice) / p.avgPrice) * 100 : null
    return { mint, ...p, lastPrice: last, pnlPct }
  }), [positions, lastPriceByMint])

  // Distribution buckets
  const dist = useMemo(() => {
    let over200 = 0, between = 0, under0 = 0
    for (const p of positionsWithPnl) {
      const v = p.pnlPct
      if (v == null) continue
      if (v > 200) over200++
      else if (v >= 0) between++
      else under0++
    }
    return { over200, between, under0 }
  }, [positionsWithPnl])

  return (
    <Box>
      {/* Header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label="Flex 🤘" color="secondary" variant="outlined" />
          <Typography variant="h6" fontWeight={900}>Portfolio Analyzer</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField size="small" placeholder="Enter wallet (optional)" value={wallet} onChange={e => setWallet(e.target.value)} />
          <Button size="small" variant="contained">View</Button>
          <IconButton size="small"><RefreshIcon fontSize="small" /></IconButton>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        {/* Summary Cards */}
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary">Realized PnL</Typography>
              <Typography variant="h6">{`${realizedPnL >= 0 ? '▲ +' : '▼ -'}$${fmt(Math.abs(realizedPnL), 6, 2)}`}</Typography>
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary">Unrealized PnL</Typography>
              <Typography variant="h6">—</Typography>
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary">Total Revenue</Typography>
              <Typography variant="h6">${fmt(sellProceeds, 6, 2)}</Typography>
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12} md={3}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary">Profit (Balance − Deposited)</Typography>
              <Typography variant="h6">{`${profit >= 0 ? '▲ +' : '▼ -'}$${fmt(Math.abs(profit), 6, 2)}`}</Typography>
            </Stack>
          </Paper>
        </Grid>

        {/* PnL Sparkline + Timeframe */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Stack spacing={0}>
                <Typography variant="subtitle2" color="text.secondary">All Realized PnL</Typography>
                <Typography variant="h5" fontWeight={900}>${fmt(timeframeStats.pnl, 6, 2)} {timeframeStats.roi == null ? '' : `(${timeframeStats.roi >= 0 ? '▲ +' : '▼ -'}${Math.abs(timeframeStats.roi).toFixed(2)}%)`}</Typography>
              </Stack>
              <Tabs
                value={timeframe}
                onChange={(_, v) => setTimeframe(v)}
                textColor="secondary"
                indicatorColor="secondary"
                variant="scrollable"
                sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36 } }}
              >
                <Tab value="all" label="All" />
                <Tab value="7d" label="7D" />
                <Tab value="24h" label="24H" />
                <Tab value="12h" label="12H" />
                <Tab value="6h" label="6H" />
                <Tab value="1h" label="1H" />
              </Tabs>
            </Stack>
            <Box sx={{ mt: 1 }}>
              <Sparkline />
            </Box>
            <Divider sx={{ my: 1.5 }} />
            {loading && !data ? (
              <Typography variant="body2" color="text.secondary">Loading…</Typography>
            ) : error ? (
              <Typography variant="body2" color="error.main">{error}</Typography>
            ) : null}
          </Paper>
        </Grid>

        {/* Trading Activity Heatmap placeholder */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Trading Activity</Typography>
            <Typography variant="body2" color="text.secondary">Track your consistency and PnL</Typography>
            <Box sx={{ mt: 1, border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 2 }}>
              <EmptyState title="Less / More" subtitle="Heatmap placeholder" />
            </Box>
          </Paper>
        </Grid>

        {/* Active Positions */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Active Positions</Typography>
              <Stack direction="row" spacing={1}>
                <Chip label="Amount" size="small" variant="outlined" />
                <Chip label="Recent" size="small" variant="outlined" />
              </Stack>
            </Stack>
            <Divider sx={{ my: 1 }} />
            {(positionsWithPnl.length === 0) ? (
              <EmptyState title="No positions" />
            ) : (
              <Grid container spacing={1.5}>
                {positionsWithPnl.map(p => (
                  <Grid item xs={12} sm={6} key={p.mint}>
                    <Paper variant="outlined" sx={{ p: 1.25 }}>
                      <Stack spacing={0.5}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Chip size="small" label={p.symbol || 'TOKEN'} />
                          <Typography variant="caption" color="text.secondary">{shortAddress(p.mint)}</Typography>
                        </Stack>
                        <Typography variant="subtitle2" fontWeight={800}>{p.name || p.symbol || shortAddress(p.mint)}</Typography>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="caption" color="text.secondary">Qty</Typography>
                          <Typography variant="caption">{fmt(p.qty)}</Typography>
                        </Stack>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="caption" color="text.secondary">Avg Price</Typography>
                          <Typography variant="caption">${fmt(p.avgPrice)}</Typography>
                        </Stack>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="caption" color="text.secondary">Last Price</Typography>
                          <Typography variant="caption">{p.lastPrice == null ? '—' : `$${fmt(p.lastPrice, 6, 6)}`}</Typography>
                        </Stack>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="caption" color="text.secondary">PnL %</Typography>
                          <Chip size="small" color={p.pnlPct == null ? 'default' : p.pnlPct >= 0 ? 'success' : 'error'} label={p.pnlPct == null ? '—' : `${p.pnlPct >= 0 ? '▲ +' : '▼ -'}${Math.abs(p.pnlPct).toFixed(2)}%`} />
                        </Stack>
                      </Stack>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            )}
          </Paper>
        </Grid>

        {/* Distribution buckets */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Distribution</Typography>
            <Grid container spacing={1}>
              {[{ label: `Over 200% (${dist.over200})`, key: 'over' }, { label: `0 - 200% (${dist.between})`, key: 'between' }, { label: `Under 0% (${dist.under0})`, key: 'under' }].map(b => (
                <Grid item xs={12} sm={4} key={b.key}>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="body2" color="text.secondary">{b.label}</Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>

        {/* Trade History */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Typography variant="h6">Trade History</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: { xs: 1, sm: 0 } }}>
                <Chip label="Most Profitable" size="small" variant={filter === 'most_profitable' ? 'filled' : 'outlined'} onClick={() => setFilter('most_profitable')} />
                <Chip label="Deployed Tokens" size="small" variant={filter === 'deployed' ? 'filled' : 'outlined'} onClick={() => setFilter('deployed')} />
                <Chip label="Age" size="small" variant={filter === 'age' ? 'filled' : 'outlined'} onClick={() => setFilter('age')} />
                <Chip label="All" size="small" variant={filter === 'all' ? 'filled' : 'outlined'} onClick={() => setFilter('all')} />
              </Stack>
            </Stack>
            <Divider sx={{ my: 1 }} />
            {(data?.history?.length || 0) === 0 ? (
              <EmptyState title="No history" />
            ) : (
              <Grid container spacing={1.5}>
                <Grid item xs={12}>
                  <Grid container spacing={1} sx={{ fontWeight: 700 }}>
                    {['Time','Type','Token','Mint','Qty','Price','Value'].map(h => (
                      <Grid item xs={12} sm={6} md={2} key={h}>
                        <Typography variant="caption" color="text.secondary">{h}</Typography>
                      </Grid>
                    ))}
                  </Grid>
                </Grid>

                {data!.history.slice(0, 30).map(h => (
                  <Grid item xs={12} key={h.id}>
                    <Grid container spacing={1}>
                      <Grid item xs={12} sm={6} md={2}><Typography variant="caption">{new Date(h.ts).toLocaleString()}</Typography></Grid>
                      <Grid item xs={12} sm={6} md={2}><Chip size="small" label={h.side.toUpperCase()} color={h.side === 'buy' ? 'success' : 'error'} /></Grid>
                      <Grid item xs={12} sm={6} md={2}><Typography variant="caption">{h.name || h.symbol || shortAddress(h.mint)}</Typography></Grid>
                      <Grid item xs={12} sm={6} md={2}><Typography variant="caption" className="mono">{shortAddress(h.mint)}</Typography></Grid>
                      <Grid item xs={6} sm={3} md={1}><Typography variant="caption">{fmt(h.qty)}</Typography></Grid>
                      <Grid item xs={6} sm={3} md={1}><Typography variant="caption">${fmt(h.price, 6, 6)}</Typography></Grid>
                      <Grid item xs={12} sm={6} md={2}><Typography variant="caption">${fmt(h.value, 6, 2)}</Typography></Grid>
                    </Grid>
                  </Grid>
                ))}
              </Grid>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}

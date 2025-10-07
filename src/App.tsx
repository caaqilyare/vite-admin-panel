import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { MemeScanner } from './features/MemeScanner'
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Grid,
  Paper,
  Stack,
  TextField,
  Button,
  Chip,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useMediaQuery,
  Divider,
  Snackbar,
  Alert,
  IconButton,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

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

type Position = {
  qty: number
  avgPrice: number
  name?: string
  symbol?: string
}

type Deposit = {
  ts: number
  amount: number
}

type AppState = {
  user: { name: string; balance: number }
  positions: Record<string, Position>
  history: HistoryItem[]
  deposits: Deposit[]
  lastScannedMint?: string
}

function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [depositAmt, setDepositAmt] = useState('')
  const [openEdit, setOpenEdit] = useState(false)
  const [openDeposit, setOpenDeposit] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<HistoryItem | null>(null)
  const [openProfile, setOpenProfile] = useState(false)
  const [openResetConfirm, setOpenResetConfirm] = useState(false)
  const [resetNoticeOpen, setResetNoticeOpen] = useState(false)
  const [copiedActivityId, setCopiedActivityId] = useState<string | null>(null)
  const [activityDense, setActivityDense] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const isSmall = useMediaQuery('(max-width:600px)')

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function fmt(n: number | null | undefined, d = 6, fixed?: number) {
    if (n == null || Number.isNaN(n)) return '-'
    const digits = n < 1 ? d : 2
    const opts: Intl.NumberFormatOptions =
      fixed != null
        ? { minimumFractionDigits: fixed, maximumFractionDigits: fixed }
        : { maximumFractionDigits: digits }
    return n.toLocaleString(undefined, opts)
  }

  function shortAddress(addr: string, left = 4, right = 4) {
    if (!addr) return ''
    if (addr.length <= left + right + 1) return addr
    return `${addr.slice(0, left)}…${addr.slice(-right)}`
  }
  function truncate(s: string, max = 18) {
    if (!s) return ''
    return s.length > max ? s.slice(0, max - 1) + '…' : s
  }

  async function handleReset() {
    try {
      setLoading(true)
      await fetch('/api/reset', { method: 'POST' })
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleExportPDF() {
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')

      // Helpers
      const nowStr = new Date().toLocaleString()
      const pct = (v: number | null) => (v == null ? '—' : `${(v).toFixed(2)}%`)

      // Derive aggregates
      const hist = state?.history || []
      const deps = state?.deposits || []
      const posEntries = Object.entries(state?.positions || {}) as Array<[string, Position]>

      // Last known price per mint from latest history item
      const lastPriceByMint = hist.reduce<Record<string, { ts: number; price: number }>>((acc, h) => {
        if (typeof h.price === 'number' && Number.isFinite(h.price)) {
          const prev = acc[h.mint]
          if (!prev || h.ts > prev.ts) acc[h.mint] = { ts: h.ts, price: h.price }
        }
        return acc
      }, {})

      // Totals by mint for Buy Amount and Sell Amount
      const totalsByMint = hist.reduce<Record<string, { buyCost: number; sellProceeds: number }>>((acc, h) => {
        const cur = acc[h.mint] || { buyCost: 0, sellProceeds: 0 }
        const val = Number(h.value) || 0
        if (h.side === 'buy') cur.buyCost += val
        else cur.sellProceeds += val
        acc[h.mint] = cur
        return acc
      }, {})

      // Build export container
      const container = document.createElement('div')
      container.style.background = '#ffffff'
      container.style.color = '#000000'
      container.style.padding = '24px'
      container.style.fontFamily = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
      container.style.width = '1024px'
      container.style.boxSizing = 'border-box'

      const section = (title: string, bodyHtml: string) => `
        <div style="margin-top: 16px;">
          <div style="font-weight:800;font-size:18px;margin-bottom:8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">${title}</div>
          ${bodyHtml}
        </div>
      `

      const summaryHtml = `
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;">
            <div style="color:#6b7280;font-size:12px;">Balance</div>
            <div style="font-weight:800;font-size:16px;">$${fmt(state?.user?.balance, 6, 2)}</div>
          </div>
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;">
            <div style="color:#6b7280;font-size:12px;">Deposited</div>
            <div style="font-weight:800;font-size:16px;">$${fmt(depositsTotal, 6, 2)}</div>
          </div>
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;">
            <div style="color:#6b7280;font-size:12px;">Realized PnL</div>
            <div style="font-weight:800;font-size:16px;">${realizedPnL >= 0 ? '▲ ' : '▼ '} $${fmt(Math.abs(realizedPnL), 6, 2)}</div>
          </div>
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;">
            <div style="color:#6b7280;font-size:12px;">Realized PnL %</div>
            <div style="font-weight:800;font-size:16px;">${realizedPnLPct == null ? '—' : (realizedPnLPct >= 0 ? '▲ +' : '▼ -') + Math.abs(realizedPnLPct).toFixed(2) + '%'}</div>
          </div>
        </div>
      `

      const depositsHtml = deps.length === 0
        ? '<div style="color:#6b7280">No deposits</div>'
        : `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;padding:6px;">Time</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${deps
              .slice()
              .sort((a,b) => a.ts - b.ts)
              .map(d => `
                <tr>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;">${new Date(d.ts).toLocaleString()}</td>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;">$${fmt(d.amount, 6, 2)}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>`

      const historyHtml = hist.length === 0
        ? '<div style="color:#6b7280">No history</div>'
        : `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;padding:6px;">Time</th>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;padding:6px;">Side</th>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;padding:6px;">Token</th>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;padding:6px;">Mint</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Qty</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Price</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Value</th>
            </tr>
          </thead>
          <tbody>
            ${hist
              .slice()
              .sort((a,b) => b.ts - a.ts)
              .map(h => `
                <tr>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;">${new Date(h.ts).toLocaleString()}</td>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;">${h.side.toUpperCase()}</td>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;">${h.name || h.symbol || shortAddress(h.mint)}</td>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;">${shortAddress(h.mint)}</td>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;">${fmt(h.qty)}</td>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;">$${fmt(h.price, 6, 6)}</td>
                  <td style="padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;">$${fmt(h.value, 6, 2)}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>`

      const perTokenHtml = posEntries.length === 0
        ? '<div style="color:#6b7280">No positions</div>'
        : `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;padding:6px;">Token</th>
              <th style="text-align:left;border-bottom:1px solid #e5e7eb;padding:6px;">Mint</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Qty</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Avg Price</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Last Price</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Buy Amount</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">Sell Amount</th>
              <th style="text-align:right;border-bottom:1px solid #e5e7eb;padding:6px;">PnL %</th>
            </tr>
          </thead>
          <tbody>
            ${posEntries.map(([m, p]) => {
              const last = lastPriceByMint[m]?.price
              const pnlPct = (typeof last === 'number' && p.avgPrice > 0) ? ((last - p.avgPrice) / p.avgPrice) * 100 : null
              const title = p.name || p.symbol || shortAddress(m)
              const totals = totalsByMint[m] || { buyCost: 0, sellProceeds: 0 }
              return `
                <tr>
                  <td style=\"padding:6px;border-bottom:1px solid #f3f4f6;\">${title}</td>
                  <td style=\"padding:6px;border-bottom:1px solid #f3f4f6;\">${shortAddress(m)}</td>
                  <td style=\"padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;\">${fmt(p.qty)}</td>
                  <td style=\"padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;\">$${fmt(p.avgPrice, 6, 6)}</td>
                  <td style=\"padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;\">${last == null ? '—' : '$' + fmt(last, 6, 6)}</td>
                  <td style=\"padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;\">$${fmt(totals.buyCost, 6, 2)}</td>
                  <td style=\"padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;\">$${fmt(totals.sellProceeds, 6, 2)}</td>
                  <td style=\"padding:6px;border-bottom:1px solid #f3f4f6;text-align:right;\">${pct(pnlPct)}</td>
                </tr>`
            }).join('')}
          </tbody>
        </table>`

      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;">
          <div>
            <div style="font-size:22px;font-weight:800;">Meme Admin Report</div>
            <div style="color:#6b7280;font-size:12px;">Generated ${nowStr}</div>
          </div>
          <div style="font-size:12px;color:#6b7280;">by Munasar abuukar</div>
        </div>
        ${section('Summary', summaryHtml)}
        ${section('Deposits', depositsHtml)}
        ${section('Recent Activity', historyHtml)}
        ${section('Per-Token PnL', perTokenHtml)}
      `

      document.body.appendChild(container)
      const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
      const w = canvas.width * ratio
      const h = canvas.height * ratio
      const x = (pageWidth - w) / 2
      const y = 10
      pdf.addImage(imgData, 'PNG', x, y, w, h)
      pdf.save('meme-admin-report.pdf')
      document.body.removeChild(container)
    } catch (e) {
      console.error('PDF export failed', e)
    }
  }

  async function refresh() {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/state')
      const data = await res.json()
      setState(data)
      if (data?.user?.name) setName(data.user.name)
    } catch (e: any) {
      setError(e?.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  async function updateName() {
    try {
      setLoading(true)
      await fetch('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  async function deposit() {
    const amount = Number(depositAmt)
    if (!Number.isFinite(amount) || amount <= 0) return
    try {
      setLoading(true)
      await fetch('/api/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }) })
      setDepositAmt('')
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  // buy/sell handled in TradePanel
  const positions = useMemo(() => {
    if (!state?.positions) return [] as Array<[string, Position]>
    return Object.entries(state.positions)
  }, [state])

  // Activity: currently showing a simple recent slice without filters/pagination

  // Profile aggregates
  const depositsTotal = useMemo(() => {
    return (state?.deposits || []).reduce((acc, d) => acc + (Number(d.amount) || 0), 0)
  }, [state?.deposits])
  const buyCost = useMemo(() => {
    return (state?.history || []).filter(h => h.side === 'buy').reduce((acc, h) => acc + (Number(h.value) || 0), 0)
  }, [state?.history])
  const sellProceeds = useMemo(() => {
    return (state?.history || []).filter(h => h.side === 'sell').reduce((acc, h) => acc + (Number(h.value) || 0), 0)
  }, [state?.history])
  const totalFees = useMemo(() => {
    return (state?.history || []).reduce((acc, h) => acc + (Number(h.fee) || 0), 0)
  }, [state?.history])
  const realizedPnL = useMemo(() => {
    return sellProceeds - buyCost - totalFees
  }, [sellProceeds, buyCost, totalFees])
  const realizedPnLPct = useMemo(() => {
    return depositsTotal > 0 ? (realizedPnL / depositsTotal) * 100 : null
  }, [realizedPnL, depositsTotal])
  const netInvested = useMemo(() => {
    return buyCost - sellProceeds
  }, [buyCost, sellProceeds])

  // Group history by token to show a single card per mint
  const groupedActivity = useMemo(() => {
    const hist = state?.history || []
    const map = new Map<string, {
      mint: string
      name?: string
      symbol?: string
      buys: HistoryItem[]
      sells: HistoryItem[]
      lastTs: number
      totalBuyQty: number
      totalSellQty: number
      lastAction?: 'buy' | 'sell'
    }>()
    for (const h of hist) {
      const g = map.get(h.mint) || { mint: h.mint, name: h.name, symbol: h.symbol, buys: [], sells: [], lastTs: h.ts, totalBuyQty: 0, totalSellQty: 0 as number, lastAction: h.side }
      if (h.side === 'buy') g.buys.push(h); else g.sells.push(h)
      if (h.ts > g.lastTs) g.lastTs = h.ts
      if (!g.name && h.name) g.name = h.name
      if (!g.symbol && h.symbol) g.symbol = h.symbol
      if (typeof h.qty === 'number') {
        if (h.side === 'buy') g.totalBuyQty += Number(h.qty) || 0
        else g.totalSellQty += Number(h.qty) || 0
      }
      g.lastAction = h.ts >= g.lastTs ? h.side : g.lastAction
      map.set(h.mint, g)
    }
    const items = Array.from(map.values()).map(g => {
      const buyCost = g.buys.reduce((a, x) => a + (Number(x.value) || 0), 0)
      const sellProceeds = g.sells.reduce((a, x) => a + (Number(x.value) || 0), 0)
      const fees = [...g.buys, ...g.sells].reduce((a, x) => a + (Number(x.fee) || 0), 0)
      const pnl = sellProceeds - buyCost - fees
      const pnlPct = buyCost > 0 ? (pnl / buyCost) * 100 : null
      const buyWeightedPrice = (() => {
        const totalQty = g.buys.reduce((a, x) => a + (Number(x.qty) || 0), 0)
        if (totalQty <= 0) return null
        const totalValue = g.buys.reduce((a, x) => a + ((Number(x.price) || 0) * (Number(x.qty) || 0)), 0)
        return totalValue / totalQty
      })()
      const sellWeightedPrice = (() => {
        const totalQty = g.sells.reduce((a, x) => a + (Number(x.qty) || 0), 0)
        if (totalQty <= 0) return null
        const totalValue = g.sells.reduce((a, x) => a + ((Number(x.price) || 0) * (Number(x.qty) || 0)), 0)
        return totalValue / totalQty
      })()
      const lastBuy = g.buys.slice().sort((a,b) => b.ts - a.ts)[0]
      const lastSell = g.sells.slice().sort((a,b) => b.ts - a.ts)[0]
      return { ...g, buyCost, sellProceeds, fees, pnl, pnlPct, buyWeightedPrice, sellWeightedPrice, lastBuy, lastSell }
    })
    // sort by latest activity desc
    items.sort((a,b) => b.lastTs - a.lastTs)
    return items
  }, [state?.history])

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="sticky" color="transparent" elevation={0} sx={{ borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)' }}>
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Chip label={state?.user?.name || '—'} onClick={() => setOpenProfile(true)} sx={{ cursor: 'pointer' }} />
          <Stack direction="row" spacing={2} alignItems="center">
            <Button variant="outlined" onClick={refresh}>Refresh</Button>
            <Button variant="outlined" color="error" onClick={() => setOpenResetConfirm(true)}>Reset</Button>
            <Button variant="contained" color="secondary" onClick={handleExportPDF}>Export PDF</Button>
            
          </Stack>
        </Toolbar>
      </AppBar>

      <Container sx={{ py: 3 }} ref={contentRef}>
        {error && <Paper sx={{ p: 2, borderColor: 'error.main' }} className="alert error">{error}</Paper>}

        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="overline" color="text.secondary">Balance</Typography>
              <Typography variant="h6">${fmt(state?.user?.balance)}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="overline" color="text.secondary">Positions</Typography>
              <Typography variant="h6">{positions.length}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="overline" color="text.secondary">Quick Actions</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<EditIcon />} variant="contained" onClick={() => setOpenEdit(true)}>Edit</Button>
                <Button size="small" startIcon={<AccountBalanceWalletIcon />} variant="outlined" onClick={() => setOpenDeposit(true)}>Deposit</Button>
              </Stack>
            </Paper>
          </Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} md={12}>
            <MemeScanner onAfterTrade={refresh} />
          </Grid>

          {positions.length > 0 && (
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>Positions</Typography>
              <Grid container spacing={1.5}>
                {positions.map(([m, p]) => {
                  const titleFull = p.name || p.symbol || m
                  const title = isSmall ? truncate(titleFull, 12) : titleFull
                  const mintShown = isSmall ? shortAddress(m) : m
                  return (
                    <Grid item xs={12} sm={6} md={4} key={m}>
                      <Paper variant="outlined" sx={{ p: 1.25 }}>
                        <Stack spacing={0.5}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Chip size="small" label={p.symbol || 'TOKEN'} />
                            <Button size="small" variant="text" onClick={async () => { try { await navigator.clipboard.writeText(m) } catch {} }}>Copy</Button>
                          </Stack>
                          <Typography variant="subtitle2" fontWeight={800} title={titleFull} sx={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{title}</Typography>
                          <Typography variant="caption" className="mono" color="text.secondary" title={m} sx={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{mintShown}</Typography>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="caption" color="text.secondary">Qty</Typography>
                            <Typography variant="caption">{fmt(p.qty)}</Typography>
                          </Stack>
                          <Stack direction="row" justifyContent="space-between">
                            <Typography variant="caption" color="text.secondary">Avg Price</Typography>
                            <Typography variant="caption">${fmt(p.avgPrice)}</Typography>
                          </Stack>
                        </Stack>
                      </Paper>
                    </Grid>
                  )
                })}
              </Grid>
            </Paper>
          </Grid>
          )}

          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="h6" gutterBottom>Recent Activity</Typography>
                <Button size="small" variant="outlined" onClick={() => setActivityDense(v => !v)}>{activityDense ? 'Comfy' : 'Compact'}</Button>
              </Stack>
              {(groupedActivity.length) === 0 ? (
                <Typography variant="body2" color="text.secondary">No activity yet</Typography>
              ) : (
                <Grid container spacing={1.5}>
                  {groupedActivity.map(g => {
                    const titleFull = g.name || g.symbol || shortAddress(g.mint)
                    const title = isSmall ? truncate(titleFull, 12) : titleFull
                    const mintShown = isSmall ? shortAddress(g.mint) : g.mint
                    const buyTime = g.lastBuy?.ts ? new Date(g.lastBuy.ts).toLocaleString() : null
                    const sellTime = g.lastSell?.ts ? new Date(g.lastSell.ts).toLocaleString() : null
                    const buyCap = g.lastBuy?.marketCap
                    const sellCap = g.lastSell?.marketCap
                    const pnlColor = (g.pnl ?? 0) >= 0 ? 'success.main' : 'error.main'
                    const isWin = (g.pnl ?? 0) >= 0
                    const cardBg = isWin
                      ? 'linear-gradient(180deg, rgba(34,197,94,0.14), rgba(34,197,94,0.06))'
                      : 'linear-gradient(180deg, rgba(239,68,68,0.14), rgba(239,68,68,0.06))'
                    const cardBorder = isWin ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(239,68,68,0.35)'
                    const copied = copiedActivityId === g.mint
                    return (
                      <Grid item xs={12} sm={6} md={4} key={g.mint}>
                        <Paper
                          variant="outlined"
                          sx={{
                            p: activityDense ? 1 : 1.5,
                            borderRadius: 2,
                            background: cardBg,
                            border: cardBorder,
                            transition: 'all .2s',
                            '&:hover': { boxShadow: 6, transform: 'translateY(-1px)' },
                          }}
                        >
                          <Stack spacing={activityDense ? 0.75 : 1}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Chip size="small" label={g.symbol || 'TOKEN'} sx={{ fontWeight: 700 }} />
                              <Stack direction="row" spacing={1} alignItems="center">
                                <Typography variant="caption" color="text.secondary">⏱ {new Date(g.lastTs).toLocaleString()}</Typography>
                                <IconButton size="small" color={copied ? 'success' : 'default'} aria-label="Copy address" onClick={async () => { try { await navigator.clipboard.writeText(g.mint); setCopiedActivityId(g.mint); setTimeout(() => setCopiedActivityId(null), 1200) } catch {} }}>
                                  <ContentCopyIcon fontSize="inherit" />
                                </IconButton>
                                {(g.lastBuy || g.lastSell) && (
                                  <IconButton size="small" aria-label="Open details" onClick={() => { const item = g.lastSell || g.lastBuy!; setSelectedActivity(item); setActivityOpen(true) }}>
                                    <OpenInNewIcon fontSize="inherit" />
                                  </IconButton>
                                )}
                              </Stack>
                            </Stack>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Typography variant="subtitle2" fontWeight={900} title={titleFull} sx={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{title}</Typography>
                              <Chip size="small" label={`${g.pnlPct == null ? '—' : (g.pnlPct >= 0 ? '▲ +' : '▼ -') + Math.abs(g.pnlPct).toFixed(2) + '%'}`} color={isWin ? 'success' : 'error'} variant="filled" />
                            </Stack>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: 0.8 }}>
                              <Chip size="small" label={isWin ? 'Winning' : 'Losing'} color={isWin ? 'success' : 'error'} variant="outlined" />
                              <Chip size="small" label={`Last: ${(g.lastAction || 'buy').toUpperCase()}`} variant="outlined" />
                            </Stack>
                            <Typography variant="caption" className="mono" color="text.secondary" title={g.mint} sx={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{mintShown}</Typography>

                            <Divider sx={{ my: 0.5, opacity: 0.6 }} />

                            <Stack spacing={0.5}>
                              <Typography variant="overline" color="text.secondary">🟢 Buy</Typography>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Time</Typography><Typography variant="caption">{buyTime || '—'}</Typography></Stack>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Price</Typography><Typography variant="caption">{g.buyWeightedPrice == null ? '—' : `$${fmt(g.buyWeightedPrice, 6, 6)}`}</Typography></Stack>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Amount</Typography><Typography variant="caption">${fmt(g.buyCost, 6, 2)}</Typography></Stack>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Qty Bought</Typography><Typography variant="caption">{fmt(g.totalBuyQty)}</Typography></Stack>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Market Cap</Typography><Typography variant="caption">{buyCap == null ? '—' : `$${Number(buyCap).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</Typography></Stack>
                            </Stack>

                            <Divider sx={{ my: 0.5, opacity: 0.6 }} />

                            <Stack spacing={0.5}>
                              <Typography variant="overline" color="text.secondary">🔴 Sell</Typography>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Time</Typography><Typography variant="caption">{sellTime || '—'}</Typography></Stack>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Price</Typography><Typography variant="caption">{g.sellWeightedPrice == null ? '—' : `$${fmt(g.sellWeightedPrice, 6, 6)}`}</Typography></Stack>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Amount</Typography><Typography variant="caption">${fmt(g.sellProceeds, 6, 2)}</Typography></Stack>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Qty Sold</Typography><Typography variant="caption">{fmt(g.totalSellQty)}</Typography></Stack>
                              <Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Market Cap</Typography><Typography variant="caption">{sellCap == null ? '—' : `$${Number(sellCap).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</Typography></Stack>
                            </Stack>

                            <Divider sx={{ my: 0.5, opacity: 0.6 }} />

                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Typography variant="caption" color="text.secondary">PnL</Typography>
                              <Typography variant="caption" fontWeight={900} color={pnlColor}>
                                {g.pnl >= 0 ? '▲ +' : '▼ -'}${fmt(Math.abs(g.pnl), 6, 2)} {g.pnlPct == null ? '' : `(${Math.abs(g.pnlPct).toFixed(2)}%)`}
                              </Typography>
                            </Stack>
                          </Stack>
                        </Paper>
                      </Grid>
                    )
                  })}
                </Grid>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Container>

      {/* Edit Profile Dialog */}
      <Dialog open={openEdit} onClose={() => setOpenEdit(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit Profile</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField autoFocus label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenEdit(false)}>Cancel</Button>
          <Button variant="contained" onClick={async () => { await updateName(); setOpenEdit(false) }}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Reset Dialog */}
      <Dialog open={openResetConfirm} onClose={() => setOpenResetConfirm(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Confirm Reset</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This will clear your positions, history, deposits, and profile data to defaults. Are you sure?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenResetConfirm(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              await handleReset()
              setOpenResetConfirm(false)
              setResetNoticeOpen(true)
            }}
          >
            Reset
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset Success Snackbar */}
      <Snackbar
        open={resetNoticeOpen}
        autoHideDuration={2500}
        onClose={() => setResetNoticeOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setResetNoticeOpen(false)} severity="success" sx={{ width: '100%' }}>
          Data has been reset.
        </Alert>
      </Snackbar>

      {/* Deposit Dialog */}
      <Dialog open={openDeposit} onClose={() => setOpenDeposit(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Deposit Funds</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Amount (USD)" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeposit(false)}>Cancel</Button>
          <Button variant="contained" startIcon={<AccountBalanceWalletIcon />} onClick={async () => { await deposit(); setOpenDeposit(false) }}>Deposit</Button>
        </DialogActions>
      </Dialog>

      {/* Activity Detail Dialog */}
      <Dialog open={activityOpen} onClose={() => { setActivityOpen(false); setSelectedActivity(null) }} maxWidth="sm" fullWidth>
        <DialogTitle>Activity Details</DialogTitle>
        <DialogContent>
          {selectedActivity ? (
            <Stack spacing={1.2} sx={{ mt: 0.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Chip size="small" label={selectedActivity.side.toUpperCase()} color={selectedActivity.side === 'buy' ? 'success' : 'error'} />
                <Typography variant="caption" color="text.secondary">{new Date(selectedActivity.ts).toLocaleString()}</Typography>
              </Stack>
              <Typography variant="subtitle1" fontWeight={800}>{selectedActivity.name || selectedActivity.symbol || selectedActivity.mint}</Typography>
              <Typography variant="caption" className="mono" color="text.secondary">{selectedActivity.mint}</Typography>
              <Divider sx={{ my: 0.5 }} />
              <Stack direction="row" justifyContent="space-between">
                <Typography color="text.secondary">Qty</Typography>
                <Typography fontWeight={700}>{fmt(selectedActivity.qty)}</Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography color="text.secondary">Price</Typography>
                <Typography fontWeight={700}>${fmt(selectedActivity.price)}</Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography color="text.secondary">Value</Typography>
                <Typography fontWeight={700}>${fmt(selectedActivity.value)}</Typography>
              </Stack>
              {typeof selectedActivity.fee === 'number' && (
                <Stack direction="row" justifyContent="space-between">
                  <Typography color="text.secondary">Fee</Typography>
                  <Typography fontWeight={700}>${fmt(selectedActivity.fee)}</Typography>
                </Stack>
              )}
              {typeof selectedActivity.marketCap === 'number' && (
                <Stack direction="row" justifyContent="space-between">
                  <Typography color="text.secondary">Market Cap</Typography>
                  <Typography fontWeight={700}>${selectedActivity.marketCap.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
                </Stack>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setActivityOpen(false); setSelectedActivity(null) }}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Profile Dialog */}
      <Dialog open={openProfile} onClose={() => setOpenProfile(false)} maxWidth="sm" fullWidth>
        <DialogTitle>My Profile</DialogTitle>
        <DialogContent>
          <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 1.5, background: 'linear-gradient(180deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))', border: '1px solid rgba(59,130,246,0.4)' }}>
                <Typography variant="caption" color="text.secondary">Balance</Typography>
                <Typography variant="h6" fontWeight={800}>${fmt(state?.user?.balance)}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 1.5, background: 'linear-gradient(180deg, rgba(99,102,241,0.15), rgba(99,102,241,0.05))', border: '1px solid rgba(99,102,241,0.4)' }}>
                <Typography variant="caption" color="text.secondary">Deposited</Typography>
                <Typography variant="h6" fontWeight={800}>${fmt(depositsTotal)}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 1.5, background: 'linear-gradient(180deg, rgba(234,179,8,0.15), rgba(234,179,8,0.05))', border: '1px solid rgba(234,179,8,0.4)' }}>
                <Typography variant="caption" color="text.secondary">Fees Paid</Typography>
                <Typography variant="h6" fontWeight={800}>${fmt(totalFees)}</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 1.5, background: (realizedPnL >= 0 ? 'linear-gradient(180deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05))' : 'linear-gradient(180deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))'), border: `1px solid ${realizedPnL >= 0 ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
                <Typography variant="caption" color="text.secondary">Realized PnL</Typography>
                <Typography variant="h6" fontWeight={800} color={realizedPnL >= 0 ? 'success.main' : 'error.main'}>
                  {realizedPnL >= 0 ? '▲ ' : '▼ '} ${fmt(Math.abs(realizedPnL))}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 1.5, background: (Number(realizedPnLPct) >= 0 ? 'linear-gradient(180deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05))' : 'linear-gradient(180deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))'), border: `1px solid ${Number(realizedPnLPct) >= 0 ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
                <Typography variant="caption" color="text.secondary">PnL % (vs Deposited)</Typography>
                <Typography variant="h6" fontWeight={800} color={Number(realizedPnLPct) >= 0 ? 'success.main' : 'error.main'}>
                  {realizedPnLPct == null ? '—' : `${realizedPnLPct >= 0 ? '▲ +' : '▼ -'}${Math.abs(realizedPnLPct).toFixed(2)}%`}
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Paper sx={{ p: 1.5, background: 'linear-gradient(180deg, rgba(124,58,237,0.15), rgba(124,58,237,0.05))', border: '1px solid rgba(124,58,237,0.4)' }}>
                <Typography variant="caption" color="text.secondary">Net Invested</Typography>
                <Typography variant="h6" fontWeight={800}>${fmt(netInvested, 6, 2)}</Typography>
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenProfile(false)}>Close</Button>
          <Button variant="contained" startIcon={<AccountBalanceWalletIcon />} onClick={() => { setOpenProfile(false); setOpenDeposit(true) }}>Quick Deposit</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default App

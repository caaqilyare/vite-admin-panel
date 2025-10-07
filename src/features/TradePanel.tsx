import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { api } from '../api/client'
import {
  Paper,
  Stack,
  Typography,
  TextField,
  Button,
  Chip,
  Divider,
  Alert,
  Grid,
  Box,
} from '@mui/material'
import ClearIcon from '@mui/icons-material/Clear'

export function TradePanel({
  mint,
  name,
  symbol,
  currentPrice,
  marketCap,
  onAfterTrade,
}: {
  mint: string
  name?: string
  symbol?: string
  currentPrice: number | null
  marketCap?: number | null
  onAfterTrade?: () => void
}) {
  const { data, mutate, error } = useSWR('state', api.getState, {
    refreshInterval: 3000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })

  const pos = data?.positions?.[mint]
  const balance = data?.user?.balance ?? 0
  const qtyHeld = pos?.qty ?? 0
  const avgPrice = pos?.avgPrice ?? 0

  const pnl = useMemo(() => {
    if (!currentPrice || !qtyHeld) return 0
    return (currentPrice - avgPrice) * qtyHeld
  }, [currentPrice, avgPrice, qtyHeld])

  const [usd, setUsd] = useState<number>(0)
  const [selectedPct, setSelectedPct] = useState<number | null>(null)
  const effPrice = useMemo(() => currentPrice ?? 0, [currentPrice])
  const TX_FEE = 0.35

  const effectiveQty = useMemo(() => (effPrice ? (usd || 0) / effPrice : 0), [usd, effPrice])
  const totalCost = useMemo(() => (effPrice && effectiveQty ? effPrice * effectiveQty : 0), [effPrice, effectiveQty])
  const grandTotal = useMemo(() => totalCost + (totalCost > 0 ? TX_FEE : 0), [totalCost])

  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'buy'|'sell'|null>(null)

  const canBuy = !!mint && effPrice > 0 && effectiveQty > 0 && totalCost <= balance
  const canSell = qtyHeld > 0 && !!currentPrice

  // Profit percentage relative to average entry price (only when holding)
  const pnlPct = useMemo(() => {
    if (!qtyHeld || !currentPrice || !avgPrice) return null
    if (avgPrice <= 0) return null
    return ((currentPrice - avgPrice) / avgPrice) * 100
  }, [qtyHeld, currentPrice, avgPrice])

  // Estimate market cap at buy time (assuming constant supply)
  const estBoughtMCap = useMemo(() => {
    if (marketCap == null || !avgPrice || !currentPrice || currentPrice === 0) return null
    return marketCap * (avgPrice / currentPrice)
  }, [marketCap, avgPrice, currentPrice])

  async function onBuy() {
    if (!canBuy) return
    try {
      setActionError(null)
      setBusy('buy')
      await api.buy({ mint, price: effPrice, qty: effectiveQty, name, symbol, marketCap: marketCap ?? undefined })
      const fresh = await api.getState()
      await mutate(fresh, { revalidate: false })
      setUsd(0)
      setSelectedPct(null)
      onAfterTrade?.()
    } catch (e: any) {
      setActionError(e?.message || 'Buy failed')
    } finally { setBusy(null) }
  }

  async function onSellAll() {
    if (!canSell || !currentPrice) return
    try {
      setActionError(null)
      setBusy('sell')
      await api.sell({ mint, price: currentPrice, marketCap: marketCap ?? undefined })
      const fresh = await api.getState()
      await mutate(fresh, { revalidate: false })
      onAfterTrade?.()
    } catch (e: any) {
      setActionError(e?.message || 'Sell failed')
    } finally { setBusy(null) }
  }

  return (
    <Paper sx={{ p: 0, overflow: 'hidden' }}>
      {/* Header with subtle gradient and token chip */}
      <Box sx={{ px: 2, py: 1.5, position: 'relative', borderBottom: '1px solid', borderColor: 'rgba(255,255,255,0.08)', background: 'linear-gradient(180deg, rgba(124,58,237,0.10), rgba(124,58,237,0.02))' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" fontWeight={800}>Trade</Typography>
          <Chip label={(symbol || name) ? `${symbol || name}` : '—'} />
        </Stack>
      </Box>

      {/* Metric chips grid */}
      <Box sx={{ p: 2 }}>
        <Grid container spacing={1.5}>
          <Grid item xs={6} md={3}>
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="caption" color="text.secondary">Price</Typography>
              <Typography fontWeight={800}>{currentPrice != null ? `$${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '—'}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="caption" color="text.secondary">Market Cap</Typography>
              <Typography fontWeight={800}>{typeof marketCap === 'number' ? `$${marketCap.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="caption" color="text.secondary">Holding</Typography>
              <Typography fontWeight={800}>{qtyHeld.toLocaleString(undefined, { maximumFractionDigits: 6 })}</Typography>
            </Paper>
          </Grid>
          <Grid item xs={6} md={3}>
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="caption" color="text.secondary">PnL</Typography>
              <Typography fontWeight={800} color={pnl >= 0 ? 'success.main' : 'error.main'}>{pnl >= 0 ? '▲ ' : '▼ '} ${Math.abs(pnl).toFixed(2)}</Typography>
            </Paper>
          </Grid>
          {qtyHeld > 0 && (
            <>
              <Grid item xs={6} md={4}>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="caption" color="text.secondary">Bought Price</Typography>
                  <Typography fontWeight={800}>{avgPrice > 0 ? `$${avgPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '—'}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={6} md={4}>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="caption" color="text.secondary">Bought MCap</Typography>
                  <Typography fontWeight={800}>{typeof estBoughtMCap === 'number' ? `$${estBoughtMCap.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="caption" color="text.secondary">Profit</Typography>
                  <Typography fontWeight={800} color={(pnlPct ?? 0) >= 0 ? 'success.main' : 'error.main'}>
                    {pnlPct == null ? '—' : `${(pnlPct >= 0 ? '▲ +' : '▼ -')}${Math.abs(pnlPct).toFixed(2)}%`}
                  </Typography>
                </Paper>
              </Grid>
            </>
          )}
        </Grid>
      </Box>

      <Box sx={{ px: 2 }}>
        {actionError && <Alert severity="error" sx={{ mb: 1 }}>{actionError}</Alert>}
        {error && <Alert severity="warning" sx={{ mb: 1 }}>Failed to load state</Alert>}
      </Box>

        {/* Buy when no holding */}
      {qtyHeld === 0 && (
        <Box sx={{ p: 2, pt: 0 }}>
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Buy</Typography>
          <Grid container spacing={1.5}>
            {/* Row 1: USD input full width */}
            <Grid item xs={12}>
              <TextField
                label="USD"
                value={usd || ''}
                onChange={(e) => { const v = Number(e.target.value); setUsd(Number.isFinite(v) ? v : 0); setSelectedPct(null) }}
                placeholder="0"
                fullWidth
              />
            </Grid>

            {/* Row 2: Presets split into two columns */}
            <Grid item xs={12} md={6}>
              <Typography variant="caption" color="text.secondary">Quick amounts</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {[25,50,100].map((v) => (
                  <Chip key={v} label={`+$${v}`} onClick={() => { setUsd((usd||0)+v); setSelectedPct(null) }} />
                ))}
                <Chip color="primary" label="MAX" onClick={() => { setUsd(Number(balance.toFixed(2))); setSelectedPct(null) }} />
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="caption" color="text.secondary">Percent of balance</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {[1,2,5,10,20,25,50].map((pct) => (
                    <Chip
                      key={pct}
                      label={`${pct}%`}
                      color={selectedPct === pct ? 'primary' : 'default'}
                      variant={selectedPct === pct ? 'filled' : 'outlined'}
                      onClick={() => { setUsd(Number((balance * (pct/100)).toFixed(2))); setSelectedPct(pct) }}
                    />
                  ))}
                </Box>
              </Stack>
            </Grid>

            {/* Full-width Clear button */}
            <Grid item xs={12}>
              <Button
                fullWidth
                size="medium"
                variant="outlined"
                color="secondary"
                startIcon={<ClearIcon />}
                disabled={(!usd || usd === 0) && selectedPct == null}
                onClick={() => { setUsd(0); setSelectedPct(null) }}
                aria-label="Clear amount"
              >
                Clear
              </Button>
            </Grid>

            {/* Cost/Fee summary */}
            <Grid item xs={12} md={6}>
              <Stack direction="row" justifyContent="space-between">
                <Typography color="text.secondary">Cost</Typography>
                <Typography>${totalCost.toFixed(2)}</Typography>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack direction="row" justifyContent="space-between">
                <Typography color="text.secondary">Fee</Typography>
                <Typography>${totalCost > 0 ? TX_FEE.toFixed(2) : '0.00'}</Typography>
              </Stack>
            </Grid>
          </Grid>
          {/* Footer bar */}
          <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(90deg, rgba(124,58,237,0.18), rgba(59,130,246,0.18))', border: '1px solid rgba(124,58,237,0.45)' }}>
            <Typography variant="subtitle1" fontWeight={800}>Total: ${grandTotal.toFixed(2)}</Typography>
            <Button variant="contained" disabled={!canBuy || busy==='buy'} onClick={onBuy}>{busy==='buy' ? 'Buying…' : 'Buy Now'}</Button>
          </Box>
        </Box>
      )}

        {/* Sell when holding */}
      {qtyHeld > 0 && (
        <Box sx={{ p: 2, pt: 0 }}>
          <Divider sx={{ mb: 1.5 }} />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle1" fontWeight={800}>Ready to exit?</Typography>
            <Button variant="contained" color="error" disabled={!canSell || busy==='sell'} onClick={onSellAll}>{busy==='sell' ? 'Selling…' : 'Sell (All)'}</Button>
          </Box>
        </Box>
      )}
    </Paper>
  )
}

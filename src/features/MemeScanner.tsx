import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import Card from '../components/Card'
import { TradePanel } from './TradePanel'
import { colors } from '../theme/colors'
import { spacing } from '../theme/spacing'
import { type } from '../theme/typography'

const DEFAULT_MINT = ''

// Types (partial) for the RugCheck response we use
interface RugTokenMeta {
  name: string
  symbol: string
  uri?: string
}

// PNL Analysis Types
interface PnlData {
  date: string
  pnl: number
  roi: number
}

interface PnlResponse {
  today: PnlData
  week: PnlData
  month: PnlData
  allTime: PnlData
  customRange?: {
    startDate: string
    endDate: string
    pnl: number
    roi: number
  }
}

// Dex types (subset)
interface DexTxnsWindow { buys: number; sells: number }
interface DexTxns { m5?: DexTxnsWindow; h1?: DexTxnsWindow; h6?: DexTxnsWindow; h24?: DexTxnsWindow }
interface DexVolume { m5?: number; h1?: number; h6?: number; h24?: number }
interface DexEntry { txns?: DexTxns; volume?: DexVolume; priceChange?: Record<string, number>; marketCap?: number; fdv?: number; pairCreatedAt?: number }
interface DexRisk { label: 'safe' | 'caution' | 'danger' | 'unknown'; score: number; reasons?: string[] }
interface DexResponse { mint: string; dex?: DexEntry; risk?: DexRisk; error?: string }
interface RugToken {
  supply: number
  decimals: number
}
interface RugReport {
  mint: string
  token: RugToken
  tokenMeta?: RugTokenMeta
  fileMeta?: { image?: string; name?: string; symbol?: string }
  risks?: { name: string; level?: string }[]
  score?: number
  score_normalised?: number
  markets?: Array<{ lpLockedPct?: number }>
  totalHolders?: number
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/
function isValidMint(m: string) {
  const s = m.trim()
  return s.length >= 32 && s.length <= 44 && BASE58_RE.test(s)
}

async function fetchRugReport([, m]: [string, string]) {
  const url = `/api/scan/report/${m}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`RugCheck ${res.status}`)
  const report: RugReport = await res.json()
  return report
}

async function fetchPrice([, m]: [string, string]): Promise<{ price: number | null; isFallback?: boolean; error?: string }> {
  const url = `/api/scan/price/${m}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Price ${res.status}`)
  const j = await res.json().catch(async () => {
    const t = await res.text().catch(() => '')
    const n = Number(t)
    return Number.isFinite(n) ? { price: n } : { price: null }
  })
  return {
    price: typeof j?.price === 'number' ? j.price : null,
    isFallback: j?.isFallback === true,
    error: typeof j?.error === 'string' ? j.error : undefined,
  }
}

async function fetchDex([, m]: [string, string]): Promise<DexResponse> {
  const url = `/api/scan/dex/${m}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Dex ${res.status}`)
  const json = await res.json()
  return json as DexResponse
}

function shortAddress(addr: string) {
  if (!addr) return ''
  if (addr.length <= 10) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}
function formatNumber(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 })
}
function formatCompact(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatOneDecimalDown(n: number) {
  if (!Number.isFinite(n)) return '—'
  const v = Math.floor(n * 10) / 10
  return v.toFixed(1)
}

type VerdictLabel = 'SAFE' | 'RISKY' | 'UNSAFE'
interface HealthVerdict { label: VerdictLabel; reasons: string[] }

function computeHealthVerdict(params: {
  volToMc: number | null
  lpLockedPct: number | undefined
  tx24: number | null
  priceCh24: number | null
  dexLabel?: 'safe' | 'caution' | 'danger' | 'unknown'
  ageMin?: number | null
  marketCap?: number | null
}): HealthVerdict {
  let score = 50
  const reasons: string[] = []

  const { volToMc, lpLockedPct, tx24, priceCh24, dexLabel, ageMin, marketCap } = params

  if (typeof volToMc === 'number' && isFinite(volToMc)) {
    if (volToMc >= 1) { score += 20; reasons.push('volume/mc strong') }
    else if (volToMc >= 0.2) { score += 5; reasons.push('volume/mc moderate') }
    else { score -= 20; reasons.push('volume/mc weak') }
  }

  if (typeof lpLockedPct === 'number') {
    if (lpLockedPct >= 75) { score += 15; reasons.push('LP locked high') }
    else if (lpLockedPct < 25) { score -= 15; reasons.push('LP lock low') }
  }

  if (typeof tx24 === 'number' && isFinite(tx24)) {
    if (tx24 >= 1000) { score += 5; reasons.push('tx active') }
    else if (tx24 < 50) { score -= 5; reasons.push('tx low') }
  }

  if (typeof priceCh24 === 'number' && isFinite(priceCh24)) {
    if (priceCh24 > 400) { score -= 10; reasons.push('extreme pump') }
    if (priceCh24 < -60) { score -= 10; reasons.push('dumping') }
  }

  if (dexLabel === 'safe') { score += 5; reasons.push('dex risk: safe') }
  if (dexLabel === 'danger') { score -= 10; reasons.push('dex risk: danger') }

  // User rule: if token age > 50 minutes and market cap < $20k -> add risk
  if (typeof ageMin === 'number' && ageMin > 50 && typeof marketCap === 'number' && isFinite(marketCap) && marketCap < 20_000) {
    score -= 10
    reasons.push('age>50m & mc<20k')
  }

  let label: VerdictLabel = 'RISKY'
  if (score >= 70) label = 'SAFE'
  else if (score <= 40) label = 'UNSAFE'

  return { label, reasons }
}

// PNL Analysis Component
function PnlAnalysis({ mint }: { mint: string }) {
  const [pnlData, setPnlData] = useState<PnlResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDateRange, setShowDateRange] = useState(false)
  // Native date inputs (yyyy-mm-dd)
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [startDateStr, setStartDateStr] = useState<string>(todayIso)
  const [endDateStr, setEndDateStr] = useState<string>(todayIso)

  const fetchPnlData = async (startDate?: Date, endDate?: Date) => {
    if (!mint) return
    
    setLoading(true)
    setError(null)
    
    try {
      let url = `/api/pnl/${mint}`
      if (startDate && endDate) {
        const params = new URLSearchParams({
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0]
        })
        url += `?${params.toString()}`
      }
      
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      })
      
      if (!response.ok) throw new Error('Failed to fetch PNL data')
      
      const data = await response.json()
      setPnlData(data)
    } catch (err) {
      console.error('Error fetching PNL data:', err)
      setError('Failed to load PNL data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPnlData()
  }, [mint])

  const handleDateRangeApply = () => {
    const startDate = new Date(startDateStr)
    const endDate = new Date(endDateStr)
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      fetchPnlData(startDate, endDate)
      setShowDateRange(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value / 100)
  }

  const getPnlColor = (value: number) => {
    if (value > 0) return 'text-green-500'
    if (value < 0) return 'text-red-500'
    return 'text-gray-400'
  }

  if (loading && !pnlData) {
    return <div className="p-4 text-center text-gray-400">Loading PNL data...</div>
  }

  if (error) {
    return <div className="p-4 text-center text-red-500">{error}</div>
  }

  if (!pnlData) return null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's PNL */}
        <div className="bg-gray-800 rounded-lg p-4 shadow">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Today's PNL</h3>
          <div className={`text-2xl font-bold ${getPnlColor(pnlData.today.pnl)}`}>
            {formatCurrency(pnlData.today.pnl)}
          </div>
          <div className={`text-sm ${getPnlColor(pnlData.today.roi)}`}>
            {formatPercent(pnlData.today.roi)} ROI
          </div>
        </div>

        {/* This Week's PNL */}
        <div className="bg-gray-800 rounded-lg p-4 shadow">
          <h3 className="text-sm font-medium text-gray-400 mb-2">This Week's PNL</h3>
          <div className={`text-2xl font-bold ${getPnlColor(pnlData.week.pnl)}`}>
            {formatCurrency(pnlData.week.pnl)}
          </div>
          <div className={`text-sm ${getPnlColor(pnlData.week.roi)}`}>
            {formatPercent(pnlData.week.roi)} ROI
          </div>
        </div>

        {/* This Month's PNL */}
        <div className="bg-gray-800 rounded-lg p-4 shadow">
          <h3 className="text-sm font-medium text-gray-400 mb-2">This Month's PNL</h3>
          <div className={`text-2xl font-bold ${getPnlColor(pnlData.month.pnl)}`}>
            {formatCurrency(pnlData.month.pnl)}
          </div>
          <div className={`text-sm ${getPnlColor(pnlData.month.roi)}`}>
            {formatPercent(pnlData.month.roi)} ROI
          </div>
        </div>

        {/* All Time PNL */}
        <div className="bg-gray-800 rounded-lg p-4 shadow">
          <h3 className="text-sm font-medium text-gray-400 mb-2">All Time PNL</h3>
          <div className={`text-2xl font-bold ${getPnlColor(pnlData.allTime.pnl)}`}>
            {formatCurrency(pnlData.allTime.pnl)}
          </div>
          <div className={`text-sm ${getPnlColor(pnlData.allTime.roi)}`}>
            {formatPercent(pnlData.allTime.roi)} ROI
          </div>
        </div>
      </div>

      {/* Custom Date Range Picker */
      }
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-white">Custom Date Range</h3>
          <button
            onClick={() => setShowDateRange(!showDateRange)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium text-white transition-colors"
          >
            {showDateRange ? 'Hide Date Picker' : 'Select Date Range'}
          </button>
        </div>

        {showDateRange && (
          <div className="bg-gray-800 p-4 rounded-lg shadow-lg mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start date</label>
                <input
                  type="date"
                  value={startDateStr}
                  max={endDateStr}
                  onChange={(e) => setStartDateStr(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End date</label>
                <input
                  type="date"
                  value={endDateStr}
                  min={startDateStr}
                  onChange={(e) => setEndDateStr(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-4">
              <button
                onClick={() => setShowDateRange(false)}
                className="px-4 py-2 border border-gray-600 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDateRangeApply}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium text-white transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {pnlData.customRange && (
          <div className="bg-gray-800 rounded-lg p-4 shadow">
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Custom Range: {new Date(pnlData.customRange.startDate).toLocaleDateString()} - {new Date(pnlData.customRange.endDate).toLocaleDateString()}
            </h3>
            <div className={`text-2xl font-bold ${getPnlColor(pnlData.customRange.pnl)}`}>
              {formatCurrency(pnlData.customRange.pnl)}
            </div>
            <div className={`text-sm ${getPnlColor(pnlData.customRange.roi)}`}>
              {formatPercent(pnlData.customRange.roi)} ROI
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function MemeScanner({ mint = DEFAULT_MINT, onAfterTrade }: { mint?: string; onAfterTrade?: () => void }) {
  const [inputMint, setInputMint] = useState(mint)
  const [searchedMint, setSearchedMint] = useState<string | null>(null)
  const hasSearched = !!searchedMint
  const canScan = isValidMint(inputMint)
  const [inputFocused, setInputFocused] = useState(false)

  const reportKey = searchedMint ? (['report', searchedMint] as const) : null
  const priceKey = searchedMint ? (['price', searchedMint] as const) : null
  const dexKey = searchedMint ? (['dex', searchedMint] as const) : null

  const { data: report, error: reportError, isLoading: reportLoading } = useSWR(
    reportKey,
    fetchRugReport,
    { refreshInterval: 300_000, revalidateOnFocus: true, keepPreviousData: true }
  )

  const { data: priceResp, error: priceError, isLoading: priceLoading } = useSWR(
    priceKey,
    fetchPrice,
    { refreshInterval: 300, dedupingInterval: 0, revalidateIfStale: true, keepPreviousData: true }
  )

  const { data: dexResp } = useSWR(
    dexKey,
    fetchDex,
    { refreshInterval: 10_000, revalidateOnFocus: true, keepPreviousData: true }
  )

  // Persist last scanned mint
  useEffect(() => {
    if (!searchedMint || !report) return
    fetch('/api/last-scanned', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint: searchedMint }) }).catch(() => {})
  }, [searchedMint, report])

  const tokenName = report?.fileMeta?.name || report?.tokenMeta?.name || ''
  const tokenSymbol = report?.fileMeta?.symbol || report?.tokenMeta?.symbol || ''
  const imageUrl = report?.fileMeta?.image
  const score = report?.score ?? report?.score_normalised
  const lpLockedPct = report?.markets?.[0]?.lpLockedPct
  const totalHolders = report?.totalHolders

  const supply = useMemo(() => {
    if (!report?.token) return 999_999_999
    const d = report.token.decimals ?? 0
    const raw = report.token.supply
    // Default to 1B if supply is missing
    const computed = Number.isFinite(raw) ? (raw as number) / Math.pow(10, d) : null
    return computed != null && isFinite(computed) && computed > 0 ? computed : 1_000_000_000
  }, [report])

  const priceUsd = useMemo(() => {
    if (priceResp?.isFallback) return null
    const p = priceResp?.price
    return typeof p === 'number' ? p : null
  }, [priceResp?.price, priceResp?.isFallback])

  const marketCap = useMemo(() => {
    if (priceUsd == null || supply == null) return null
    return priceUsd * supply
  }, [priceUsd, supply])

  // Per request: do not fall back to Dex; market cap comes from Fluxbeam price * RugCheck supply only

  // Derived metrics for Health Check
  const tx24 = useMemo(() => {
    const h24b = Number(dexResp?.dex?.txns?.h24?.buys ?? 0)
    const h24s = Number(dexResp?.dex?.txns?.h24?.sells ?? 0)
    const total = h24b + h24s
    if (total > 0) return total
    // fallback rough estimate from h1 * 24
    const h1b = Number(dexResp?.dex?.txns?.h1?.buys ?? 0)
    const h1s = Number(dexResp?.dex?.txns?.h1?.sells ?? 0)
    const est = (h1b + h1s) * 24
    return est > 0 ? est : null
  }, [dexResp?.dex?.txns])

  const vol24 = useMemo(() => {
    const v = dexResp?.dex?.volume?.h24
    return typeof v === 'number' && isFinite(v) ? v : null
  }, [dexResp?.dex?.volume?.h24])

  // Age in minutes from Dex pair creation time
  const ageMin = useMemo(() => {
    const createdAt = Number(dexResp?.dex?.pairCreatedAt)
    if (!Number.isFinite(createdAt) || createdAt <= 0) return null
    const ms = Date.now() - createdAt
    return ms > 0 ? Math.floor(ms / 60000) : null
  }, [dexResp?.dex?.pairCreatedAt])

  const volToMc = useMemo(() => {
    const mc = marketCap
    if (vol24 != null && mc != null && mc > 0) return vol24 / mc
    return null
  }, [vol24, marketCap])

  const estimatedGasSol = useMemo(() => {
    // Using 0.0015 SOL per transaction as per user guidance
    const perTx = 0.002
    return typeof tx24 === 'number' && isFinite(tx24) ? tx24 * perTx : null
  }, [tx24])

  const priceCh24 = useMemo(() => {
    const p = dexResp?.dex?.priceChange?.['h24']
    return typeof p === 'number' && isFinite(p) ? p : null
  }, [dexResp?.dex?.priceChange])

  const health = useMemo(() => {
    return computeHealthVerdict({
      volToMc,
      lpLockedPct,
      tx24,
      priceCh24,
      dexLabel: dexResp?.risk?.label,
      ageMin,
      marketCap,
    })
  }, [volToMc, lpLockedPct, tx24, priceCh24, dexResp?.risk?.label, ageMin, marketCap])

  const [priceUsdStable, setPriceUsdStable] = useState<number | null>(null)
  const [supplyStable, setSupplyStable] = useState<number | null>(null)
  const [marketCapStable, setMarketCapStable] = useState<number | null>(null)

  // Recommendation based on health, age, market cap, LP, tx activity
  const recommendation = useMemo(() => {
    const tips: string[] = []
    const label = health?.label
    const mc = marketCap
    const locked = typeof lpLockedPct === 'number' ? lpLockedPct : null
    const tx = typeof tx24 === 'number' ? tx24 : null
    const oldAndSmall = (typeof ageMin === 'number' && ageMin > 50) && (typeof mc === 'number' && mc < 20_000)

    if (label === 'SAFE') {
      tips.push('Gradual entry (DCA) with stops')
      if (locked != null && locked >= 75) tips.push('LP lock strong')
      if (tx != null && tx >= 1000) tips.push('Active market conditions')
    } else if (label === 'RISKY') {
      tips.push('Wait for confirmation (volume or LP)')
      if (locked != null && locked < 25) tips.push('Low LP lock')
      if (volToMc != null && volToMc < 0.2) tips.push('Weak vol/MC')
      if (oldAndSmall) tips.push('Older microcap; elevated risk')
    } else if (label === 'UNSAFE') {
      tips.push('Avoid for now')
      if (oldAndSmall) tips.push('Old and sub-$20k market')
      if (priceCh24 != null && priceCh24 > 400) tips.push('Extreme pump risk')
      if (priceCh24 != null && priceCh24 < -60) tips.push('Heavy dumping')
    }

    const headline = label === 'SAFE' ? 'Safe Recommendation' : label === 'RISKY' ? 'Caution Recommendation' : 'High-Risk Recommendation'
    const vibe = label === 'SAFE' ? 'cool' : label === 'RISKY' ? 'cautious' : 'unsafe'
    return { headline, vibe, tips }
  }, [health?.label, lpLockedPct, tx24, volToMc, ageMin, marketCap, priceCh24])

  useEffect(() => {
    if (typeof priceUsd === 'number' && isFinite(priceUsd)) setPriceUsdStable(priceUsd)
  }, [priceUsd])

  useEffect(() => {
    if (typeof supply === 'number' && isFinite(supply) && supply > 0) setSupplyStable(supply)
  }, [supply])

  useEffect(() => {
    if (typeof marketCap === 'number' && isFinite(marketCap)) {
      setMarketCapStable(marketCap)
    } else if (priceUsdStable != null && supplyStable != null) {
      setMarketCapStable(Number((priceUsdStable * supplyStable).toFixed(2)))
    }
  }, [marketCap, priceUsdStable, supplyStable])

  return (
    <Card variant="glass">
      <div style={{ width: '100%', maxWidth: '95%', margin: '0 auto' }}>
        {/* Search row */}
        <div style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.035))',
          border: `1px solid ${colors.surfaceBorder}`,
          borderRadius: 18,
          padding: spacing.sm,
          marginBottom: spacing.md,
          boxShadow: '0 8px 28px rgba(0,0,0,0.28) inset, 0 6px 18px rgba(0,0,0,0.25)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)'
        }}>
          <div
            className="searchRow"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: spacing.sm,
              alignItems: 'stretch'
            }}
          >
            <input
              value={inputMint}
              onChange={e => setInputMint(e.target.value)}
              placeholder="Paste Solana token mint..."
              className="mono"
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={e => {
                if (e.key === 'Enter' && canScan) setSearchedMint(inputMint.trim())
              }}
              style={{
                background: 'linear-gradient(180deg, #0b0f1a, #0a0d17)',
                color: colors.textPrimary,
                border: `1px solid ${inputFocused ? '#7c3aed' : colors.surfaceBorder}`,
                borderRadius: 12,
                padding: '12px 16px',
                outline: 'none',
                height: 44,
                boxShadow: inputFocused ? '0 0 0 4px rgba(124,58,237,0.18), 0 2px 10px rgba(0,0,0,0.35) inset' : '0 2px 10px rgba(0,0,0,0.25) inset',
                letterSpacing: 0.2,
                flex: '1 1 260px',
                minWidth: 0
              }}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              title="Paste from clipboard"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText()
                  if (text) setInputMint(text.trim())
                } catch {}
              }}
              style={{
                height: 44,
                width: 110,
                padding: '0 14px',
                borderRadius: 12,
                border: `1px solid ${colors.surfaceBorder}`,
                background: 'rgba(255,255,255,0.06)',
                color: colors.textPrimary,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                flex: '0 0 110px'
              }}
            >
              <span>📋</span>
              <span>Paste</span>
            </button>
            <button
              title={canScan ? 'Scan token' : 'Enter a valid mint to scan'}
              onClick={() => canScan && setSearchedMint(inputMint.trim())}
              className="primary"
              disabled={!canScan}
              style={{
                height: 44,
                width: 110,
                padding: '0 16px',
                borderRadius: 12,
                fontWeight: 900,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: canScan ? 'linear-gradient(90deg, #7c3aed, #06b6d4)' : undefined,
                border: canScan ? 'none' : undefined,
                boxShadow: canScan ? '0 4px 18px rgba(124,58,237,0.35)' : undefined,
                color: canScan ? '#ffffff' : undefined,
                flex: '0 0 110px'
              }}
            >
              <span>🔎</span>
              <span>{hasSearched ? 'Rescan' : 'Scan'}</span>
            </button>
            <button
              title="Clear input"
              onClick={() => { setInputMint(''); setSearchedMint(null); }}
              style={{
                height: 44,
                width: 110,
                padding: '0 14px',
                borderRadius: 12,
                border: `1px solid ${colors.surfaceBorder}`,
                background: 'transparent',
                color: colors.textSecondary,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                flex: '0 0 110px'
              }}
            >
              <span>✖️</span>
              <span>Clear</span>
            </button>
          </div>
          <div style={{ color: colors.textSecondary, marginTop: 6, fontSize: type.label, opacity: 0.8 }}>
            Example: 3b11QJ******Lpump • Press Enter to scan
          </div>
          {!canScan && inputMint.trim().length > 0 && (
            <div style={{ color: '#ff7b7b', fontSize: 12, marginTop: 4 }}>Invalid mint format</div>
          )}
          <div className="divider" />
        </div>

        {/* States */}
        {!hasSearched ? (
          <div style={{ textAlign: 'center', padding: `${spacing.lg}px 0` }}>
            <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.06)', border: `1px solid ${colors.surfaceBorder}`, padding: '4px 10px', borderRadius: 999, color: colors.textSecondary, fontWeight: 700 }}>Meme Scanner</div>
            <div style={{ color: colors.textPrimary, fontSize: type.h2, fontWeight: 800, marginTop: 8 }}>Scan a Solana token</div>
            <div style={{ color: colors.textSecondary }}>Get safety score, holders, supply and live price.</div>
          </div>
        ) : (reportLoading || (!report && priceLoading)) ? (
          <div>
            <div className="skeletonHeader" />
          </div>
        ) : (reportError || priceError) ? (
          <div className="alert error">Failed: {String(reportError || priceError)}</div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', gap: spacing.md, alignItems: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, overflow: 'hidden', border: `2px solid ${colors.surfaceBorder}`, background: colors.surface }}>
                {imageUrl ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <img src={imageUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : <div style={{ width: '100%', height: '100%' }} />}
              </div>
              <div>
                <div style={{ color: colors.textPrimary, fontSize: type.h2, fontWeight: 800 }}>{tokenName || shortAddress(searchedMint!)}</div>
                <div className="mono" style={{ color: colors.textSecondary, fontSize: type.label }}>{shortAddress(searchedMint!)}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {tokenSymbol ? <div style={{ color: colors.textSecondary, fontWeight: 600, fontSize: type.label }}>({tokenSymbol})</div> : null}
                  {typeof score === 'number' && (
                    <div style={{ background: 'rgba(94,234,212,0.12)', border: `1px solid ${colors.success}`, padding: '2px 8px', borderRadius: 999, color: colors.success, fontWeight: 700, fontSize: type.label }}>Score {Math.round(score)}</div>
                  )}
                  {/* Dex risk badge */}
                  {dexResp?.risk && (
                    <div
                      title={dexResp?.risk?.reasons?.join(', ') || ''}
                      style={{
                        background: dexResp.risk.label === 'safe' ? 'rgba(94,234,212,0.12)' : dexResp.risk.label === 'danger' ? 'rgba(239,68,68,0.12)' : 'rgba(255,209,102,0.12)',
                        border: `1px solid ${dexResp.risk.label === 'safe' ? colors.success : dexResp.risk.label === 'danger' ? '#ff7b7b' : '#ffd166'}`,
                        padding: '2px 8px',
                        borderRadius: 999,
                        color: dexResp.risk.label === 'safe' ? colors.success : dexResp.risk.label === 'danger' ? '#ff7b7b' : '#ffd166',
                        fontWeight: 800,
                        fontSize: type.label,
                      }}
                    >
                      {dexResp.risk.label.toUpperCase()} {Math.round(dexResp.risk.score)}
                    </div>
                  )}
                  {/* Dex txn/volume badges */}
                  {typeof dexResp?.dex?.volume?.h24 === 'number' && (
                    <div style={{ border: `1px solid ${colors.surfaceBorder}`, padding: '2px 8px', borderRadius: 999, color: colors.textSecondary, fontWeight: 800, fontSize: type.label }}>Vol 24h ${formatCompact(dexResp.dex.volume.h24)}</div>
                  )}
                  {dexResp?.dex?.txns?.m5 && (
                    <div style={{ border: `1px solid ${colors.surfaceBorder}`, padding: '2px 8px', borderRadius: 999, color: colors.textSecondary, fontWeight: 800, fontSize: type.label }}>m5 B{dexResp.dex.txns.m5.buys}/S{dexResp.dex.txns.m5.sells}</div>
                  )}
                  {dexResp?.dex?.txns?.h1 && (
                    <div style={{ border: `1px solid ${colors.surfaceBorder}`, padding: '2px 8px', borderRadius: 999, color: colors.textSecondary, fontWeight: 800, fontSize: type.label }}>h1 B{dexResp.dex.txns.h1.buys}/S{dexResp.dex.txns.h1.sells}</div>
                  )}
                </div>
              </div>
              {/* Refresh icon removed per request */}
            </div>

            {/* Metrics */}
            <div className="metricsRow" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: spacing.md, marginTop: spacing.md }}>
              <div className="card">
                <div className="kpi-title">Price</div>
                <div className="kpi-value">{(priceUsdStable ?? priceUsd) != null ? `$${formatNumber((priceUsdStable ?? priceUsd) as number)}` : '—'}</div>
              </div>
              <div className="card">
                <div className="kpi-title">Market Cap</div>
                <div className="kpi-value">{(marketCapStable ?? marketCap) != null ? `$${formatCompact((marketCapStable ?? marketCap) as number)}` : '—'}</div>
              </div>
              <div className="card">
                <div className="kpi-title">Supply</div>
                <div className="kpi-value">{(supplyStable ?? supply) != null ? formatCompact((supplyStable ?? supply) as number) : '—'}</div>
              </div>
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: 10, marginTop: spacing.sm, flexWrap: 'wrap' }}>
              {typeof lpLockedPct === 'number' && (
                <div style={{ border: `1px solid ${lpLockedPct >= 75 ? colors.success : lpLockedPct >= 25 ? '#ffd166' : '#ff7b7b'}`, background: lpLockedPct >= 75 ? 'rgba(94,234,212,0.12)' : lpLockedPct >= 25 ? 'rgba(255,209,102,0.12)' : 'rgba(255,123,123,0.12)', padding: '7px 12px', borderRadius: 999, color: colors.textSecondary, fontWeight: 800 }}>🔒 LP Locked {lpLockedPct.toFixed(0)}%</div>
              )}
              {typeof totalHolders === 'number' && (
                <div style={{ border: `1px solid ${totalHolders >= 10000 ? colors.success : totalHolders >= 1000 ? '#ffd166' : colors.surfaceBorder}`, background: totalHolders >= 10000 ? 'rgba(94,234,212,0.12)' : totalHolders >= 1000 ? 'rgba(255,209,102,0.12)' : 'rgba(255,255,255,0.06)', padding: '7px 12px', borderRadius: 999, color: colors.textSecondary, fontWeight: 800 }}>👥 {formatCompact(totalHolders)} holders</div>
              )}
            </div>

            {/* Health Check */}
            <div className="card" style={{ marginTop: spacing.md }}>
              <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                Health Check
                {health?.label && (
                  <span
                    style={{
                      marginLeft: 8,
                      background:
                        health.label === 'SAFE' ? 'rgba(94,234,212,0.12)' :
                        health.label === 'UNSAFE' ? 'rgba(239,68,68,0.12)' : 'rgba(255,209,102,0.12)',
                      border: `1px solid ${health.label === 'SAFE' ? colors.success : health.label === 'UNSAFE' ? '#ff7b7b' : '#ffd166'}`,
                      padding: '2px 8px', borderRadius: 999, fontWeight: 800, color:
                        health.label === 'SAFE' ? colors.success : health.label === 'UNSAFE' ? '#ff7b7b' : '#ffd166', fontSize: type.label
                    }}
                  >
                    {health.label}
                  </span>
                )}
              </h3>

              <div className="metricsRow" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: spacing.md }}>
                <div className="card" style={{ background: 'transparent', border: `1px dashed ${colors.surfaceBorder}` }}>
                  <div className="kpi-title">Vol/MC</div>
                  <div className="kpi-value">{volToMc != null ? (volToMc >= 1 ? 'Strong' : volToMc >= 0.2 ? 'Moderate' : 'Weak') : '—'}</div>
                </div>
                <div className="card" style={{ background: 'transparent', border: `1px dashed ${colors.surfaceBorder}` }}>
                  <div className="kpi-title">24h Volume</div>
                  <div className="kpi-value">{vol24 != null ? `$${formatCompact(vol24)}` : '—'}</div>
                </div>
                <div className="card" style={{ background: 'transparent', border: `1px dashed ${colors.surfaceBorder}` }}>
                  <div className="kpi-title">Global Fees Paid</div>
                  <div className="kpi-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img
                      src="https://axiom.trade/images/sol-fill.svg"
                      alt="SOL"
                      style={{ width: 16, height: 16, filter: 'drop-shadow(0 0 6px rgba(124,58,237,0.45))' }}
                    />
                    {estimatedGasSol != null ? (
                      <>
                        <span title={`${(estimatedGasSol ?? 0).toFixed(2)} SOL`} style={{ fontWeight: 900 }}>
                          {formatOneDecimalDown(estimatedGasSol)}
                        </span>
                        <span style={{ opacity: 0.8, fontSize: type.label }}>SOL</span>
                      </>
                    ) : '—'}
                  </div>
                </div>
              </div>
              {health?.reasons?.length ? (
                <ul style={{ marginTop: 6, marginBottom: 0, color: colors.textSecondary }}>
                  {health.reasons.map((r, i) => (
                    <li key={i} style={{ fontSize: type.label }}>{r}</li>
                  ))}
                </ul>
              ) : null}

              {/* Recommendation */}
              <div className="card" style={{ marginTop: spacing.sm, background: 'transparent', border: `1px dashed ${colors.surfaceBorder}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{recommendation.headline}</strong>
                  <span
                    style={{
                      background: recommendation.vibe === 'cool' ? 'rgba(94,234,212,0.12)' : recommendation.vibe === 'cautious' ? 'rgba(255,209,102,0.12)' : 'rgba(239,68,68,0.12)',
                      border: `1px solid ${recommendation.vibe === 'cool' ? colors.success : recommendation.vibe === 'cautious' ? '#ffd166' : '#ff7b7b'}`,
                      padding: '2px 8px', borderRadius: 999, fontWeight: 800, color: recommendation.vibe === 'cool' ? colors.success : recommendation.vibe === 'cautious' ? '#ffd166' : '#ff7b7b', fontSize: type.label
                    }}
                  >
                    {recommendation.vibe.toUpperCase()}
                  </span>
                </div>
                {recommendation.tips.length ? (
                  <ul style={{ marginTop: 6, marginBottom: 0, color: colors.textSecondary }}>
                    {recommendation.tips.map((t, i) => (
                      <li key={i} style={{ fontSize: type.label }}>{t}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            {/* PNL Analysis Section */}
            <div className="card" style={{ marginTop: spacing.md }}>
              <h3 style={{ marginTop: 0, marginBottom: spacing.md }}>PNL Analysis</h3>
              {searchedMint && <PnlAnalysis mint={searchedMint} />}
            </div>

            {/* Trading */}
            <div className="card" style={{ marginTop: spacing.md }}>
              <h3 style={{ marginTop: 0 }}>Trade</h3>
              <TradePanel
                mint={searchedMint!}
                symbol={tokenSymbol || undefined}
                currentPrice={(priceUsdStable ?? priceUsd) ?? null}
                marketCap={(marketCapStable ?? marketCap) ?? null}
                onAfterTrade={onAfterTrade}
              />
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

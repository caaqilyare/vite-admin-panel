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

async function fetchPrice([, m]: [string, string]): Promise<{ price: number | null }> {
  const url = `/api/scan/price/${m}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Price ${res.status}`)
  const j = await res.json().catch(async () => {
    const t = await res.text().catch(() => '')
    const n = Number(t)
    return Number.isFinite(n) ? { price: n } : { price: null }
  })
  return { price: typeof j?.price === 'number' ? j.price : null }
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

export function MemeScanner({ mint = DEFAULT_MINT, onAfterTrade }: { mint?: string; onAfterTrade?: () => void }) {
  const [inputMint, setInputMint] = useState(mint)
  const [searchedMint, setSearchedMint] = useState<string | null>(null)
  const hasSearched = !!searchedMint
  const canScan = isValidMint(inputMint)

  const reportKey = searchedMint ? (['report', searchedMint] as const) : null
  const priceKey = searchedMint ? (['price', searchedMint] as const) : null

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
    if (!report?.token) return null
    const d = report.token.decimals ?? 0
    const raw = report.token.supply
    return Number.isFinite(raw) ? raw / Math.pow(10, d) : null
  }, [report])

  const priceUsd = useMemo(() => {
    const p = priceResp?.price
    return typeof p === 'number' ? p : null
  }, [priceResp?.price])

  const marketCap = useMemo(() => {
    if (priceUsd == null || supply == null) return null
    return priceUsd * supply
  }, [priceUsd, supply])

  const [priceUsdStable, setPriceUsdStable] = useState<number | null>(null)
  const [supplyStable, setSupplyStable] = useState<number | null>(null)
  const [marketCapStable, setMarketCapStable] = useState<number | null>(null)

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
      <div style={{ width: '100%', maxWidth: 820, margin: '0 auto' }}>
        {/* Search row */}
        <div style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${colors.surfaceBorder}`, borderRadius: 14, padding: spacing.sm, marginBottom: spacing.md }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: spacing.sm }}>
            <input
              value={inputMint}
              onChange={e => setInputMint(e.target.value)}
              placeholder="Paste Solana token mint..."
              className="mono"
              style={{ background: '#0f1320', color: colors.textPrimary, border: `1px solid ${colors.surfaceBorder}`, borderRadius: 12, padding: '10px 12px' }}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button onClick={() => canScan && setSearchedMint(inputMint.trim())} className="primary" disabled={!canScan}> {hasSearched ? 'Rescan' : 'Scan'} </button>
            <button onClick={() => { setInputMint(''); setSearchedMint(null); }}>Clear</button>
          </div>
          <div style={{ color: colors.textSecondary, marginTop: 6, fontSize: type.label }}>Example: 3b11QJ******Lpump</div>
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
                <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                  {tokenSymbol ? <div style={{ color: colors.textSecondary, fontWeight: 600, fontSize: type.label }}>({tokenSymbol})</div> : null}
                  {typeof score === 'number' && (
                    <div style={{ background: 'rgba(94,234,212,0.12)', border: `1px solid ${colors.success}`, padding: '2px 8px', borderRadius: 999, color: colors.success, fontWeight: 700, fontSize: type.label }}>Score {Math.round(score)}</div>
                  )}
                </div>
              </div>
              <div>
                <button onClick={() => setSearchedMint(searchedMint)} className="icon-btn">⟳</button>
              </div>
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

            {/* Trading */}
            <div className="card" style={{ marginTop: spacing.md }}>
              <h3 style={{ marginTop: 0 }}>Trade</h3>
              <TradePanel
                mint={searchedMint!}
                name={tokenName || undefined}
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

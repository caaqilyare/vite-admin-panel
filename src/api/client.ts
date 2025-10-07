export type AppState = {
  user: { name: string; balance: number }
  positions: Record<string, { qty: number; avgPrice: number; name?: string; symbol?: string }>
  history: Array<{ id: string; ts: number; side: 'buy'|'sell'; mint: string; name?: string; symbol?: string; price: number; qty: number; value: number }>
  deposits: Array<{ ts: number; amount: number }>
  lastScannedMint?: string
}

async function parseJSONSafe(res: Response) {
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

async function request<T = any>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...opts })
  const data = await parseJSONSafe(res)
  if (!res.ok) throw new Error((data as any)?.error || res.statusText)
  return data as T
}

export const api = {
  async getState(): Promise<AppState> {
    return await request<AppState>('/api/state')
  },
  async setUser(payload: { name: string }): Promise<AppState> {
    return await request<AppState>('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  },
  async deposit(payload: { amount: number }): Promise<AppState> {
    return await request<AppState>('/api/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  },
  async buy(payload: { mint: string; price: number; qty: number; name?: string; symbol?: string; marketCap?: number }): Promise<AppState> {
    return await request<AppState>('/api/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  },
  async sell(payload: { mint: string; price: number; qty?: number; marketCap?: number }): Promise<AppState> {
    return await request<AppState>('/api/sell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  },
}

'use client'

import { useEffect, useMemo, useState } from 'react'

type AuditItem = {
  id: string
  title: string
  handle: string
  status: string | null
  slugs: string[]
}

type PageInfo = { hasNextPage: boolean; endCursor: string | null }

export default function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasNext, setHasNext] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [q, setQ] = useState('')

  const load = async (reset = false) => {
    setLoading(true)
    try {
      const url = new URL('/api/admin/products-audit', window.location.origin)
      if (!reset && cursor) url.searchParams.set('cursor', cursor)
      url.searchParams.set('limit', '50')

      const res = await fetch(url.toString(), { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: { items: AuditItem[]; pageInfo: PageInfo } = await res.json()

      setItems(prev => reset ? json.items : [...prev, ...json.items])
      setCursor(json.pageInfo.endCursor)
      setHasNext(json.pageInfo.hasNextPage)
    } catch (e) {
      console.error(e)
      alert('Failed to load products. Check console.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // initial load
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    let rows = items
    if (onlyUnassigned) rows = rows.filter(r => r.slugs.length === 0)
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      rows = rows.filter(r =>
        r.title.toLowerCase().includes(t) ||
        r.handle.toLowerCase().includes(t) ||
        r.slugs.some(s => s.toLowerCase().includes(t))
      )
    }
    return rows
  }, [items, onlyUnassigned, q])

  // small helper: extract numeric id for Admin link
  const toNumericId = (gid: string) => {
    const m = gid.match(/\/(\d+)$|Product\/(\d+)$/)
    return m ? (m[1] || m[2]) : ''
  }

  return (
    <main className="p-8 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl font-bold">Products ↔ Categories Audit</h1>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyUnassigned}
              onChange={e => setOnlyUnassigned(e.target.checked)}
            />
            Show only unassigned
          </label>
          <input
            className="border rounded px-3 py-2 text-sm w-64"
            placeholder="Search title / handle / slug…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button
            className="bg-gray-100 hover:bg-gray-200 border rounded px-3 py-2 text-sm"
            onClick={() => { setCursor(null); load(true) }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3 w-[40%]">Product</th>
              <th className="p-3">Slugs</th>
              <th className="p-3">Status</th>
              <th className="p-3">Admin</th>
              <th className="p-3">Storefront</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 align-top">
                  <div className="font-semibold">{r.title}</div>
                  <div className="text-xs text-gray-500">@{r.handle}</div>
                </td>
                <td className="p-3 align-top">
                  {r.slugs.length === 0 ? (
                    <span className="inline-block text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-800 border border-yellow-200">
                      Unassigned
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.slugs.map(s => (
                        <span key={s} className="inline-block text-xs px-2 py-1 rounded bg-gray-100 border">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="p-3 align-top">
                  <span className="text-xs">{r.status || '-'}</span>
                </td>
                <td className="p-3 align-top">
                  <a
                    className="text-blue-600 underline text-xs"
                    href={`https://${process.env.NEXT_PUBLIC_SHOPIFY_SHOP || process.env.SHOPIFY_SHOP}.myshopify.com/admin/products/${toNumericId(r.id)}`}
                    target="_blank" rel="noreferrer"
                  >
                    Open
                  </a>
                </td>
                <td className="p-3 align-top">
                  <a
                    className="text-blue-600 underline text-xs"
                    href={`/products/${r.handle}`}
                    target="_blank" rel="noreferrer"
                  >
                    View
                  </a>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="p-6 text-sm text-gray-500" colSpan={5}>
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="flex items-center gap-3">
        <button
          className="bg-white border rounded px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={() => load(false)}
          disabled={loading || !hasNext}
        >
          {loading ? 'Loading…' : hasNext ? 'Load more' : 'No more'}
        </button>
        <div className="text-xs text-gray-500">
          Showing {filtered.length} of {items.length} loaded
        </div>
      </div>
    </main>
  )
}
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

type Category = {
  id: string
  title: string
  slug: string
  parentId: string | null
  children?: Category[]
}

type FlatCategory = { slug: string; label: string; depth: number }

export default function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasNext, setHasNext] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [q, setQ] = useState('')
  const [cats, setCats] = useState<FlatCategory[]>([])
  const [selectedSlugByProduct, setSelectedSlugByProduct] = useState<Record<string, string>>({})
  const [replaceExistingByProduct, setReplaceExistingByProduct] = useState<Record<string, boolean>>({})
  const [assigningId, setAssigningId] = useState<string | null>(null)

  // Load products (paged)
  const load = async (reset = false) => {
    setLoading(true)
    try {
      const url = new URL('/api/admin/products-audit', window.location.origin)
      if (!reset && cursor) url.searchParams.set('cursor', cursor)
      url.searchParams.set('limit', '50')

      const res = await fetch(url.toString(), { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: { items: AuditItem[]; pageInfo: PageInfo } = await res.json()

      setItems(prev => (reset ? json.items : [...prev, ...json.items]))
      setCursor(json.pageInfo.endCursor)
      setHasNext(json.pageInfo.hasNextPage)
    } catch (e) {
      console.error(e)
      alert('Failed to load products. Check console.')
    } finally {
      setLoading(false)
    }
  }

  // Load categories and flatten for a select
  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch('/api/categories', { cache: 'no-store' })
        const tree: Category[] = await res.json()
        const out: FlatCategory[] = []
        const walk = (nodes: Category[], depth = 0) => {
          for (const n of nodes) {
            out.push({ slug: n.slug, label: n.title, depth })
            if (n.children?.length) walk(n.children, depth + 1)
          }
        }
        walk(tree, 0)
        setCats(out)
      } catch (e) {
        console.error('Failed to load categories', e)
      }
    }
    run()
    // initial product page load
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

  const toNumericId = (gid: string) => {
    const m = gid.match(/\/(\d+)$/) || gid.match(/Product\/(\d+)$/)
    return m ? m[1] : ''
  }

  const handleAssign = async (product: AuditItem) => {
    const selectedSlug = selectedSlugByProduct[product.id]
    if (!selectedSlug) {
      alert('Choose a category first.')
      return
    }
    setAssigningId(product.id)
    try {
      const nextSlugs = replaceExistingByProduct[product.id]
        ? [selectedSlug] // replace all with this slug
        : Array.from(new Set([...(product.slugs || []), selectedSlug])) // append unique

      // Use your existing assign endpoint (Option 1 from earlier):
      // POST /api/product-categories  { productId, slugs }
      const res = await fetch('/api/product-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          slugs: nextSlugs,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Assign failed: ${t}`)
      }

      // Update row locally (no full reload needed)
      setItems(prev =>
        prev.map(it => (it.id === product.id ? { ...it, slugs: nextSlugs } : it))
      )
    } catch (e) {
      console.error(e)
      alert((e as Error).message || 'Failed to assign category')
    } finally {
      setAssigningId(null)
    }
  }

  return (
    <main className="p-8 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Products + Categories View</h1>
          <p className="text-slate-600 text-sm">Assign categories inline or filter to find unassigned products.</p>
        </div>
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
            onClick={() => {
              setCursor(null)
              load(true)
            }}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-3 w-[36%]">Product</th>
              <th className="p-3">Current Slugs</th>
              <th className="p-3">Status</th>
              <th className="p-3">Admin</th>
              <th className="p-3 w-[34%]">Assign Category</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 align-top">
                  <div className="font-semibold text-slate-900">{r.title}</div>
                  <div className="text-xs text-slate-500">@{r.handle}</div>
                </td>

                <td className="p-3 align-top">
                  {r.slugs.length === 0 ? (
                    <span className="inline-block text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-800 border border-yellow-200">
                      Unassigned
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.slugs.map(s => (
                        <span key={s} className="inline-block text-xs px-2 py-1 rounded bg-slate-100 border border-slate-200 text-slate-700">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                <td className="p-3 align-top">
                  <span className="text-xs text-slate-700">{r.status || '-'}</span>
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
                  <div className="flex flex-col gap-2">
                    {/* Category dropdown */}
                    <select
                      className="border rounded px-2 py-1"
                      value={selectedSlugByProduct[r.id] || ''}
                      onChange={e =>
                        setSelectedSlugByProduct(prev => ({ ...prev, [r.id]: e.target.value }))
                      }
                    >
                      <option value="">Select a category…</option>
                      {cats.map(c => (
                        <option key={c.slug} value={c.slug}>
                          {'\u00A0'.repeat(c.depth * 2)}{c.label} ({c.slug})
                        </option>
                      ))}
                    </select>

                    {/* Replace existing or append */}
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={!!replaceExistingByProduct[r.id]}
                        onChange={e =>
                          setReplaceExistingByProduct(prev => ({ ...prev, [r.id]: e.target.checked }))
                        }
                      />
                      Replace existing slugs (use only the selected one)
                    </label>

                    <div>
                      <button
                        onClick={() => handleAssign(r)}
                        disabled={assigningId === r.id}
                        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded px-3 py-2 disabled:opacity-60"
                      >
                        {assigningId === r.id ? 'Assigning…' : 'Assign Category'}
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="p-6 text-sm text-slate-500" colSpan={5}>
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
        <div className="text-xs text-slate-500">
          Showing {filtered.length} of {items.length} loaded
        </div>
      </div>
    </main>
  )
}
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

type FlatCategory = { id: string; slug: string; label: string; depth: number }

export default function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasNext, setHasNext] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [q, setQ] = useState('')
  const [cats, setCats] = useState<FlatCategory[]>([])
  const [selectedCatIdByProduct, setSelectedCatIdByProduct] = useState<Record<string, string>>({})
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

  // Load categories and flatten (with id + slug)
  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch('/api/categories', { cache: 'no-store' })
        const tree: Category[] = await res.json()

        const out: FlatCategory[] = []
        const walk = (nodes: Category[], depth = 0) => {
          for (const n of nodes) {
            out.push({ id: n.id, slug: n.slug, label: n.title, depth })
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
    const categoryId = selectedCatIdByProduct[product.id]
    if (!categoryId) {
      alert('Choose a category first.')
      return
    }

    const replaceExisting = !!replaceExistingByProduct[product.id]
    setAssigningId(product.id)
    try {
      // Send exactly what your API expects now:
      // { productGid, categoryId, replaceExisting }
      const res = await fetch('/api/product-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productGid: product.id,
          categoryId,
          replaceExisting,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Assign failed: ${t}`)
      }

      // Optimistically update the row’s slugs (so UI reflects the change)
      const chosen = cats.find(c => c.id === categoryId)
      setItems(prev =>
        prev.map(it =>
          it.id === product.id
            ? {
                ...it,
                slugs: replaceExisting
                  ? (chosen ? [chosen.slug] : [])
                  : Array.from(new Set([...(it.slugs || []), chosen?.slug].filter(Boolean))) as string[],
              }
            : it
        )
      )
    } catch (e) {
      console.error(e)
      alert((e as Error).message || 'Failed to assign category')
    } finally {
      setAssigningId(null)
    }
  }

// Added 9.14.25 to allow for deleting a slug assignment from a product
const [unassigningKey, setUnassigningKey] = useState<string | null>(null);

async function handleUnassign(product: AuditItem, slug: string) {
  setUnassigningKey(`${product.id}:${slug}`);
  try {
    const res = await fetch('/api/product-categories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productGid: product.id, slug }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Unassign failed: ${t}`);
    }
    // UPDATE UI
    setItems(prev =>
      prev.map(it =>
        it.id === product.id
          ? { ...it, slugs: it.slugs.filter(s => s !== slug) }
          : it
      )
    );
  } catch (e) {
    console.error(e);
    alert((e as Error).message || 'Failed to unassign category');
  } finally {
    setUnassigningKey(null);
  }
}

async function handleUnassignAll(product: AuditItem) {
  if (!confirm('Remove all category assignments for this product?')) return;
  setUnassigningKey(`${product.id}:ALL`);
  try {
    const res = await fetch('/api/product-categories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productGid: product.id, all: true }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Unassign-all failed: ${t}`);
    }
    setItems(prev =>
      prev.map(it => (it.id === product.id ? { ...it, slugs: [] } : it))
    );
  } catch (e) {
    console.error(e);
    alert((e as Error).message || 'Failed to unassign all categories');
  } finally {
    setUnassigningKey(null);
  }
}

  return (
    <main className="p-8 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Products + Categories View</h1>
          <p className="text-slate-700 text-sm">Assign categories inline or filter to find unassigned products.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={onlyUnassigned}
              onChange={e => setOnlyUnassigned(e.target.checked)}
            />
            Show only unassigned
          </label>
          <input
            className="border border-slate-300 rounded px-3 py-2 text-sm w-64 text-slate-900 placeholder:text-slate-500"
            placeholder="Search title / handle / slug…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button
            className="bg-gray-100 hover:bg-gray-200 border border-slate-300 rounded px-3 py-2 text-sm text-slate-900"
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

      <section className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-3 w-[36%] text-slate-900">Product</th>
              <th className="p-3 text-slate-900">Current Slugs</th>
              <th className="p-3 text-slate-900">Status</th>
              <th className="p-3 text-slate-900">Admin</th>
              <th className="p-3 w-[34%] text-slate-900">Assign Category</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-200">
                <td className="p-3 align-top">
                  <div className="font-semibold text-slate-900">{r.title}</div>
                  <div className="text-xs text-slate-600">@{r.handle}</div>
                </td>
              
              <td className="p-3 align-top">
                {r.slugs.length === 0 ? (
                  <span className="inline-block text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-900 border border-yellow-300">
                    Unassigned
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {r.slugs.map(s => (
                     <span key={s} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-100 border border-slate-300 text-slate-900">
                      {s}
                    <button
                      className="ml-1 text-slate-500 hover:text-red-700"
                      title="Remove this assignment"
                      onClick={() => handleUnassign(r, s)}
                      disabled={unassigningKey === `${r.id}:${s}`}
                      >
                      {unassigningKey === `${r.id}:${s}` ? '…' : '×'}
                    </button>
                  </span>
              ))}
                  </div>
            )}
            </td>
                
                <td className="p-3 align-top">
                  <span className="text-xs text-slate-800">{r.status || '-'}</span>
                </td>

                <td className="p-3 align-top">
                  <a
                    className="text-blue-700 underline text-xs"
                    href={`https://${process.env.NEXT_PUBLIC_SHOPIFY_SHOP || process.env.SHOPIFY_SHOP}.myshopify.com/admin/products/${toNumericId(r.id)}`}
                    target="_blank" rel="noreferrer"
                  >
                    Open
                  </a>
                </td>

                <td className="p-3 align-top">
                  <div className="flex flex-col gap-2">
                    {/* Category dropdown (uses categoryId as the value) */}
                    <select
                      className="border border-slate-300 rounded px-2 py-1 text-slate-900"
                      value={selectedCatIdByProduct[r.id] || ''}
                      onChange={e =>
                        setSelectedCatIdByProduct(prev => ({ ...prev, [r.id]: e.target.value }))
                      }
                    >
                      <option value="">Select a category…</option>
                      {cats.map(c => (
                        <option key={c.id} value={c.id}>
                          {'\u00A0'.repeat(c.depth * 2)}{c.label} ({c.slug})
                        </option>
                      ))}
                    </select>

                    {/* Replace existing or append */}
                    <label className="inline-flex items-center gap-2 text-xs text-slate-800">
                      <input
                        type="checkbox"
                        checked={!!replaceExistingByProduct[r.id]}
                        onChange={e =>
                          setReplaceExistingByProduct(prev => ({ ...prev, [r.id]: e.target.checked }))
                        }
                      />
                      Replace existing slugs (use only the selected one)
                    </label>

                  <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAssign(r)}
                        disabled={assigningId === r.id}
                        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded px-3 py-2 disabled:opacity-60"
                        >
                       {assigningId === r.id ? 'Assigning…' : 'Assign Category'}
                     </button>
                  {r.slugs.length > 0 && (
                      <button
                      onClick={() => handleUnassignAll(r)}
                      disabled={unassigningKey === `${r.id}:ALL`}
                      className="inline-flex items-center gap-2 bg-white border border-slate-300 hover:bg-gray-50 text-slate-900 text-xs font-medium rounded px-3 py-2 disabled:opacity-60"
                      title="Remove all category assignments from this product"
                    >
                      {unassigningKey === `${r.id}:ALL` ? 'Removing…' : 'Unassign all'}
                    </button>
                )}
                 </div>
              </div>
            </td>    
         </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="p-6 text-sm text-slate-700" colSpan={5}>
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="flex items-center gap-3">
        <button
          className="bg-white border border-slate-300 rounded px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 text-slate-900"
          onClick={() => load(false)}
          disabled={loading || !hasNext}
        >
          {loading ? 'Loading…' : hasNext ? 'Load more' : 'No more'}
        </button>
        <div className="text-xs text-slate-600">
          Showing {filtered.length} of {items.length} loaded
        </div>
      </div>
    </main>
  )
}

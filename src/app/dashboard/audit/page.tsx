'use client'

import { useEffect, useState } from 'react'

/* ---------- Types ---------- */
type ProductNode = {
  id: string
  handle: string
  title: string
  featuredImage?: { url?: string | null; altText?: string | null } | null
}
type ProductsResponse = {
  products?: {
    edges: Array<{ node: ProductNode }>
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
  }
}
type Fitment = {
  id: string
  productGid: string
  yearFrom: number | null
  yearTo: number | null
  make: string
  model: string
  trim: string | null
  chassis: string | null
}

/* ---------- Helpers ---------- */
function parseProductsResponse(json: unknown): {
  nodes: ProductNode[]
  hasNext: boolean
  endCursor: string | null
} {
  const fallback = { nodes: [] as ProductNode[], hasNext: false, endCursor: null as string | null }
  if (!json || typeof json !== 'object') return fallback

  const maybe = json as ProductsResponse & Record<string, unknown>
  const edges =
    maybe.products?.edges ??
    ((maybe as Record<string, unknown>).edges as Array<{ node: ProductNode }> | undefined)

  const pageInfo =
    maybe.products?.pageInfo ??
    ((maybe as Record<string, unknown>).pageInfo as
      | { hasNextPage?: boolean; endCursor?: string | null }
      | undefined)

  if (!edges || !Array.isArray(edges)) return fallback
  const nodes = edges.map(e => e.node).filter(Boolean)
  const hasNext = Boolean(pageInfo?.hasNextPage)
  const endCursor = pageInfo?.endCursor ?? null
  return { nodes, hasNext, endCursor }
}

function sanitizeInt(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
function emptyToNull(s?: string | null): string | null {
  if (s == null) return null
  const t = s.trim()
  return t ? t : null
}

/* ---------- Page ---------- */
export default function AuditWithFitmentsPage() {
  // products
  const [products, setProducts] = useState<ProductNode[]>([])
  const [loading, setLoading] = useState(false)
  const [hasNext, setHasNext] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  // fitments per product
  const [fitmentsMap, setFitmentsMap] = useState<Record<string, Fitment[]>>({})

  // inline “new fitment” form state per product
  type NewFitmentInput = {
    yearFrom: string
    yearTo: string
    make: string
    model: string
    trim: string
    chassis: string
  }
  const [newFitmentByProduct, setNewFitmentByProduct] = useState<
    Record<string, NewFitmentInput>
  >({})

  /* ----- data loaders ----- */
  async function loadProducts(append = false) {
    if (loading) return
    setLoading(true)
    try {
      const url = new URL('/api/admin/products', window.location.origin)
      if (append && nextCursor) url.searchParams.set('after', nextCursor)
      const res = await fetch(url.toString(), { method: 'GET' })
      if (!res.ok) {
        console.error('Products HTTP', res.status)
        return
      }
      const parsed = parseProductsResponse(await res.json())
      setProducts(prev => (append ? [...prev, ...parsed.nodes] : parsed.nodes))
      setHasNext(parsed.hasNext)
      setNextCursor(parsed.endCursor)
    } finally {
      setLoading(false)
    }
  }

  async function loadFitments(productGid: string) {
    try {
      const url = new URL('/api/admin/fitments', window.location.origin)
      url.searchParams.set('productGid', productGid)
      const res = await fetch(url.toString(), { method: 'GET', cache: 'no-store' })
      if (!res.ok) {
        console.error('fitments GET', res.status)
        return
      }
      const list = (await res.json()) as Fitment[]
      setFitmentsMap(prev => ({ ...prev, [productGid]: list }))
    } catch (e) {
      console.error('loadFitments error', e)
    }
  }

  useEffect(() => {
    void loadProducts(false)
  }, [])

  /* ----- fitment actions ----- */
  function ensureForm(productGid: string) {
    setNewFitmentByProduct(prev =>
      prev[productGid]
        ? prev
        : {
            ...prev,
            [productGid]: {
              yearFrom: '',
              yearTo: '',
              make: '',
              model: '',
              trim: '',
              chassis: '',
            },
          }
    )
  }

  async function addFitment(productGid: string) {
    ensureForm(productGid)
    const f = newFitmentByProduct[productGid]
    if (!f) return

    const body = {
      productGid,
      yearFrom: sanitizeInt(f.yearFrom),
      yearTo: sanitizeInt(f.yearTo),
      make: f.make.trim(),
      model: f.model.trim(),
      trim: emptyToNull(f.trim),
      chassis: emptyToNull(f.chassis),
    }
    if (!body.make || !body.model) {
      alert('Make and Model are required')
      return
    }
    const res = await fetch('/api/admin/fitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const t = await res.text()
      alert(`Add fitment failed: ${t}`)
      return
    }
    await loadFitments(productGid)
    setNewFitmentByProduct(prev => ({
      ...prev,
      [productGid]: { yearFrom: '', yearTo: '', make: '', model: '', trim: '', chassis: '' },
    }))
  }

  async function removeFitment(id: string, productGid: string) {
    const res = await fetch('/api/admin/fitments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      const t = await res.text()
      alert(`Remove fitment failed: ${t}`)
      return
    }
    await loadFitments(productGid)
  }

  function productImg(p: ProductNode): string {
    return p.featuredImage?.url || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif'
  }

  /* ----- UI ----- */
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-black mb-4">Audit – Products & Fitments</h1>

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => loadProducts(false)}
          className="px-3 py-2 rounded bg-gray-200 text-black hover:bg-gray-300"
          disabled={loading}
        >
          Refresh Products
        </button>
        {hasNext && (
          <button
            onClick={() => loadProducts(true)}
            className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
            disabled={loading}
          >
            Load More
          </button>
        )}
      </div>

      <div className="overflow-x-auto border border-gray-300 rounded-lg">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-gray-100 border-b border-gray-300">
            <tr>
              <th className="text-left p-3 font-semibold text-black">Product</th>
              <th className="text-left p-3 font-semibold text-black">Handle</th>
              <th className="text-left p-3 font-semibold text-black">Fitments</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-6 text-center text-gray-600">
                  {loading ? 'Loading products…' : 'No products found'}
                </td>
              </tr>
            ) : (
              products.map(p => {
                const form = newFitmentByProduct[p.id]
                const fitments = fitmentsMap[p.id] || []

                return (
                  <tr key={p.id} className="border-b border-gray-200 align-top">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={productImg(p)}
                          alt={p.title}
                          className="w-14 h-14 object-cover rounded border"
                        />
                        <div>
                          <div className="font-semibold text-black">{p.title}</div>
                          <div className="text-xs text-gray-600">{p.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="text-black">{p.handle}</div>
                    </td>
                    <td className="p-3">
                      <div className="mb-2">
                        <button
                          className="text-blue-700 underline"
                          onClick={() => loadFitments(p.id)}
                        >
                          {fitments.length ? 'Reload fitments' : 'Load fitments'}
                        </button>
                      </div>

                      {fitments.length > 0 && (
                        <ul className="mb-3 space-y-1">
                          {fitments.map(f => {
                            const yr =
                              f.yearFrom && f.yearTo
                                ? `${f.yearFrom}–${f.yearTo}`
                                : f.yearFrom
                                  ? `${f.yearFrom}`
                                  : f.yearTo
                                    ? `${f.yearTo}`
                                    : ''
                            const extras = [f.trim, f.chassis].filter(Boolean).join(' / ')
                            return (
                              <li
                                key={f.id}
                                className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-2 py-1"
                              >
                                <span className="text-black">
                                  {yr ? `${yr} ` : ''}
                                  {f.make} {f.model}
                                  {extras ? ` (${extras})` : ''}
                                </span>
                                <button
                                  className="text-red-600 text-xs"
                                  onClick={() => removeFitment(f.id, p.id)}
                                >
                                  Remove
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      {/* add fitment */}
                      <div className="grid grid-cols-6 gap-2 items-end">
                        <input
                          className="border rounded px-2 py-1 text-black"
                          placeholder="Year From"
                          value={form?.yearFrom ?? ''}
                          onChange={e =>
                            setNewFitmentByProduct(prev => ({
                              ...prev,
                              [p.id]: {
                                ...(prev[p.id] ?? {
                                  yearFrom: '',
                                  yearTo: '',
                                  make: '',
                                  model: '',
                                  trim: '',
                                  chassis: '',
                                }),
                                yearFrom: e.target.value,
                              },
                            }))
                          }
                        />
                        <input
                          className="border rounded px-2 py-1 text-black"
                          placeholder="Year To"
                          value={form?.yearTo ?? ''}
                          onChange={e =>
                            setNewFitmentByProduct(prev => ({
                              ...prev,
                              [p.id]: { ...(prev[p.id] ?? prevBlank()), yearTo: e.target.value },
                            }))
                          }
                        />
                        <input
                          className="border rounded px-2 py-1 text-black col-span-2"
                          placeholder="Make *"
                          value={form?.make ?? ''}
                          onChange={e =>
                            setNewFitmentByProduct(prev => ({
                              ...prev,
                              [p.id]: { ...(prev[p.id] ?? prevBlank()), make: e.target.value },
                            }))
                          }
                        />
                        <input
                          className="border rounded px-2 py-1 text-black col-span-2"
                          placeholder="Model *"
                          value={form?.model ?? ''}
                          onChange={e =>
                            setNewFitmentByProduct(prev => ({
                              ...prev,
                              [p.id]: { ...(prev[p.id] ?? prevBlank()), model: e.target.value },
                            }))
                          }
                        />
                        <input
                          className="border rounded px-2 py-1 text-black"
                          placeholder="Trim"
                          value={form?.trim ?? ''}
                          onChange={e =>
                            setNewFitmentByProduct(prev => ({
                              ...prev,
                              [p.id]: { ...(prev[p.id] ?? prevBlank()), trim: e.target.value },
                            }))
                          }
                        />
                        <input
                          className="border rounded px-2 py-1 text-black"
                          placeholder="Chassis"
                          value={form?.chassis ?? ''}
                          onChange={e =>
                            setNewFitmentByProduct(prev => ({
                              ...prev,
                              [p.id]: { ...(prev[p.id] ?? prevBlank()), chassis: e.target.value },
                            }))
                          }
                        />
                        <button
                          className="col-span-2 px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => addFitment(p.id)}
                        >
                          Add fitment
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function prevBlank(): {
  yearFrom: string; yearTo: string; make: string; model: string; trim: string; chassis: string
} {
  return { yearFrom: '', yearTo: '', make: '', model: '', trim: '', chassis: '' }
}
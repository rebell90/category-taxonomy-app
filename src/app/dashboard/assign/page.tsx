'use client'

import { useEffect, useState } from 'react'

type Category = {
  id: string
  title: string
  slug: string
  parentId: string | null
  children?: Category[]
}

type ProductHit = {
  id: string
  title: string
  handle: string
  image: string | null
  status: string
}

export default function AssignPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductHit | null>(null)
  const [categoryId, setCategoryId] = useState<string>('')

  useEffect(() => {
    fetch('/api/categories', { cache: 'no-store' })
      .then(r => r.json())
      .then(setCategories)
  }, [])

  const flatten = (node: Category, level = 0): { id: string; title: string; indent: string }[] => {
    const rows = [{ id: node.id, title: node.title, indent: '— '.repeat(level) }]
    node.children?.forEach(c => rows.push(...flatten(c, level + 1)))
    return rows
  }

  const link = async () => {
    if (!selectedProduct?.id || !categoryId) return alert('Pick both product and category')
    const res = await fetch('/api/product-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productGid: selectedProduct.id, categoryId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return alert('Link failed: ' + (err.error || res.statusText))
    }
    alert('Linked and metafield updated!')
  }

  const unlink = async () => {
    if (!selectedProduct?.id || !categoryId) return alert('Pick both product and category')
    const res = await fetch('/api/product-categories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productGid: selectedProduct.id, categoryId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return alert('Unlink failed: ' + (err.error || res.statusText))
    }
    alert('Unlinked and metafield updated!')
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium">Product</label>
        <ProductSearch onPick={setSelectedProduct} />
        {selectedProduct && (
          <div className="text-xs text-gray-600">
            Selected: <b>{selectedProduct.title}</b> ({selectedProduct.id})
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Category</label>
        <select
          className="border p-2 rounded"
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
        >
          <option value="">Select Category…</option>
          {categories.flatMap(cat => flatten(cat).map(o => (
            <option key={o.id} value={o.id}>{o.indent + o.title}</option>
          )))}
        </select>
      </div>

      <div className="flex gap-2">
        <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={link}>Assign</button>
        <button className="bg-gray-600 text-white px-4 py-2 rounded" onClick={unlink}>Unassign</button>
      </div>

      <p className="text-xs text-gray-500">
        After assigning, the product’s metafield <code>taxonomy.category_slugs</code> is rebuilt automatically.
      </p>
    </section>
  )
}

/* ---------- ProductSearch component ---------- */

function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

function ProductSearch({ onPick }: { onPick: (p: ProductHit | null) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ProductHit[]>([])
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const debounced = useDebounced(query, 300)

  useEffect(() => {
    let active = true
    async function run() {
      if (!debounced) {
        setHits([]); setNextCursor(null)
        return
      }
      setLoading(true)
      try {
        const params = new URLSearchParams({ q: debounced, first: '20' })
        const res = await fetch(`/api/admin/products?` + params.toString())
        const json = await res.json()
        if (active) {
          setHits(json.items || [])
          setNextCursor(json.nextCursor || null)
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    return () => { active = false }
  }, [debounced])

  const loadMore = async () => {
    if (!nextCursor || !debounced) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: debounced, first: '20', after: nextCursor })
      const res = await fetch(`/api/admin/products?` + params.toString())
      const json = await res.json()
      setHits(prev => [...prev, ...(json.items || [])])
      setNextCursor(json.nextCursor || null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative">
      <input
        className="border p-2 rounded w-full"
        placeholder='Search products (e.g., title:exhaust, sku:1234)'
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {loading && <div className="absolute right-2 top-2 text-xs text-gray-500">Loading…</div>}

      {hits.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-80 overflow-auto rounded border bg-white shadow">
{hits.map(p => (
  <button
    key={p.id}
    onClick={() => { onPick(p); setQuery(''); setHits([]) }}
    className="w-full flex items-center gap-3 p-2 hover:bg-blue-50 text-left"
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {p.image ? (
      <img src={p.image} alt="" className="h-8 w-8 object-cover rounded" />
    ) : (
      <div className="h-8 w-8 rounded bg-gray-200" />
    )}
    <div className="flex-1">
      <div className="text-base font-bold text-gray-900">{p.title}</div>
      <div className="text-xs text-gray-500">{p.handle} · {p.status}</div>
    </div>
  </button>
))}
          {nextCursor && (
            <button onClick={loadMore} className="w-full p-2 text-sm text-blue-600 hover:bg-gray-50">
              Load more…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
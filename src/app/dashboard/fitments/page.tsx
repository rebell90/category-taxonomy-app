'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'

/* =========================
   Types
========================= */

type Product = {
  id: string           // productGid (gid://shopify/Product/…)
  title: string
  handle: string
  imageUrl?: string | null
}

type ProductSearchResponse = {
  products: Product[]
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
  createdAt?: string
  updatedAt?: string
}

type ListFitmentsResponse = {
  fitments: Fitment[]
}

type UpsertFitmentRequest = {
  productGid: string
  yearFrom?: number | null
  yearTo?: number | null
  make: string
  model: string
  trim?: string | null
  chassis?: string | null
}

type UpsertFitmentResponse = Fitment

type DeleteFitmentRequest = {
  id: string
}

/* =========================
   Helpers
========================= */

const toIntOrNull = (s: string): number | null => {
  const n = Number(s.trim())
  return Number.isFinite(n) ? n : null
}

function emptyToNull(s?: string | null): string | null {
  if (s === undefined || s === null) return null
  const trimmed = s.trim()
  return trimmed.length ? trimmed : null
}

/* =========================
   API calls (typed)
========================= */

async function searchProducts(q: string): Promise<Product[]> {
  const url = `/api/admin/products?q=${encodeURIComponent(q)}`
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`Search HTTP ${res.status}`)
  const json: ProductSearchResponse = await res.json()
  return json.products
}

async function listFitments(productGid: string): Promise<Fitment[]> {
  const url = `/api/admin/fitments?productGid=${encodeURIComponent(productGid)}`
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`List fitments HTTP ${res.status}`)
  const json: ListFitmentsResponse = await res.json()
  return json.fitments
}

async function upsertFitment(payload: UpsertFitmentRequest): Promise<Fitment> {
  const res = await fetch('/api/admin/fitments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upsert failed: ${text}`)
  }
  const json: UpsertFitmentResponse = await res.json()
  return json
}

async function deleteFitment(id: string): Promise<void> {
  const res = await fetch('/api/admin/fitments', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id } as DeleteFitmentRequest),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Delete failed: ${text}`)
  }
}

/* =========================
   Component
========================= */

export default function FitmentsDashboard() {
  // Search
  const [query, setQuery] = useState<string>('')
  const [searching, setSearching] = useState<boolean>(false)
  const [results, setResults] = useState<Product[]>([])

  // Selection
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  // Fitments for selected product
  const [fitments, setFitments] = useState<Fitment[]>([])
  const [loadingFits, setLoadingFits] = useState<boolean>(false)

  // Form state for add/update
  const [yearFrom, setYearFrom] = useState<string>('')
  const [yearTo, setYearTo] = useState<string>('')
  const [make, setMake] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [trim, setTrim] = useState<string>('')
  const [chassis, setChassis] = useState<string>('')

  const canSubmit = useMemo(() => {
    return Boolean(selectedProduct && make.trim() && model.trim())
  }, [selectedProduct, make, model])

  // Search handler
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    setSearching(true)
    try {
      const items = await searchProducts(query)
      setResults(items)
    } catch (err) {
      console.error(err)
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  // When a product is chosen, load its fitments
  useEffect(() => {
    (async () => {
      if (!selectedProduct) {
        setFitments([])
        return
      }
      setLoadingFits(true)
      try {
        const rows = await listFitments(selectedProduct.id)
        setFitments(rows)
      } catch (err) {
        console.error(err)
        setFitments([])
      } finally {
        setLoadingFits(false)
      }
    })()
  }, [selectedProduct])

  // Add/Update fitment
  const handleUpsert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProduct) return

    const payload: UpsertFitmentRequest = {
      productGid: selectedProduct.id,
      make: make.trim(),
      model: model.trim(),
      yearFrom: emptyToNull(yearFrom) !== null ? toIntOrNull(yearFrom) : null,
      yearTo: emptyToNull(yearTo) !== null ? toIntOrNull(yearTo) : null,
      trim: emptyToNull(trim),
      chassis: emptyToNull(chassis),
    }

    try {
      const saved = await upsertFitment(payload)
      // Replace if exists (by unique key fields) or append
      setFitments(prev => {
        const idx = prev.findIndex(f =>
          f.productGid === saved.productGid &&
          f.make.toLowerCase() === saved.make.toLowerCase() &&
          f.model.toLowerCase() === saved.model.toLowerCase() &&
          (f.yearFrom ?? null) === (saved.yearFrom ?? null) &&
          (f.yearTo ?? null) === (saved.yearTo ?? null) &&
          (f.trim ?? null) === (saved.trim ?? null) &&
          (f.chassis ?? null) === (saved.chassis ?? null)
        )
        if (idx >= 0) {
          const copy = [...prev]
          copy[idx] = saved
          return copy
        }
        return [saved, ...prev]
      })

      // Clear form
      setYearFrom('')
      setYearTo('')
      setMake('')
      setModel('')
      setTrim('')
      setChassis('')
    } catch (err) {
      console.error(err)
      alert((err as Error).message)
    }
  }

  // Delete fitment
  const onDelete = async (fitmentId: string) => {
    try {
      await deleteFitment(fitmentId)
      setFitments(prev => prev.filter(f => f.id !== fitmentId))
    } catch (err) {
      console.error(err)
      alert((err as Error).message)
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-zinc-900">Fitment Admin</h1>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4 flex items-center gap-2">
        <input
          className="border rounded-md px-3 py-2 w-full text-zinc-900"
          placeholder="Search products by title or handle..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-4 py-2"
          disabled={searching}
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {/* Results */}
      {results.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2 text-zinc-900">Results</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedProduct(p)}
                className={`flex items-center gap-3 border rounded-lg p-3 text-left hover:shadow-sm transition ${
                  selectedProduct?.id === p.id ? 'ring-2 ring-blue-500' : ''
                }`}
              >
                <div className="relative w-14 h-14 shrink-0 rounded-md overflow-hidden bg-zinc-100">
                  {p.imageUrl ? (
                    <Image
                      src={p.imageUrl}
                      alt={p.title}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-zinc-200" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-zinc-900 truncate">{p.title}</div>
                  <div className="text-xs text-zinc-600 truncate">Handle: {p.handle}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected product + Fitments */}
      {selectedProduct && (
        <section className="mt-6">
          <header className="flex items-center gap-3 mb-4">
            <div className="relative w-16 h-16 overflow-hidden rounded-md bg-zinc-100">
              {selectedProduct.imageUrl ? (
                <Image
                  src={selectedProduct.imageUrl}
                  alt={selectedProduct.title}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full bg-zinc-200" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-zinc-900">{selectedProduct.title}</h2>
              <div className="text-sm text-zinc-700 break-all">{selectedProduct.id}</div>
            </div>
          </header>

          {/* Add/Update form */}
          <form onSubmit={handleUpsert} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <input
              className="border rounded-md px-3 py-2 text-zinc-900"
              placeholder="Make (e.g. Porsche)"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              required
            />
            <input
              className="border rounded-md px-3 py-2 text-zinc-900"
              placeholder="Model (e.g. 911)"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
            />
            <input
              className="border rounded-md px-3 py-2 text-zinc-900"
              placeholder="Trim (optional)"
              value={trim}
              onChange={(e) => setTrim(e.target.value)}
            />
            <input
              className="border rounded-md px-3 py-2 text-zinc-900"
              placeholder="Chassis (optional)"
              value={chassis}
              onChange={(e) => setChassis(e.target.value)}
            />
            <input
              className="border rounded-md px-3 py-2 text-zinc-900"
              placeholder="Year From (optional)"
              inputMode="numeric"
              value={yearFrom}
              onChange={(e) => setYearFrom(e.target.value)}
            />
            <input
              className="border rounded-md px-3 py-2 text-zinc-900"
              placeholder="Year To (optional)"
              inputMode="numeric"
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
            />

            <div className="sm:col-span-2 lg:col-span-3">
              <button
                type="submit"
                className="bg-green-600 hover:bg-green-700 text-white rounded-md px-4 py-2"
                disabled={!canSubmit}
              >
                {canSubmit ? 'Add / Update Fitment' : 'Fill required fields'}
              </button>
            </div>
          </form>

          {/* Fitments list */}
          <div>
            <h3 className="text-lg font-semibold mb-2 text-zinc-900">Existing Fitments</h3>
            {loadingFits ? (
              <div className="text-zinc-700">Loading…</div>
            ) : fitments.length === 0 ? (
              <div className="text-zinc-700">No fitments yet for this product.</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {fitments.map((f) => (
                  <div key={f.id} className="border rounded-lg p-3">
                    <div className="text-zinc-900 font-medium">
                      {f.make} {f.model}
                    </div>
                    <div className="text-sm text-zinc-700">
                      {f.yearFrom ?? '—'} – {f.yearTo ?? '—'}
                      {f.trim ? ` • Trim: ${f.trim}` : ''}
                      {f.chassis ? ` • Chassis: ${f.chassis}` : ''}
                    </div>
                    <div className="mt-2">
                      <button
                        onClick={() => onDelete(f.id)}
                        className="text-red-600 text-sm hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type ProductNode = {
  id: string;           // gid://shopify/Product/...
  handle: string;
  title: string;
  featuredImage?: { url?: string | null } | null;
};

type ProductsResponse = {
  products: {
    edges: Array<{ node: ProductNode }>;
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  };
};

type Fitment = {
  id: string;
  productGid: string;
  make: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  trim: string | null;
  chassis: string | null;
};

type FitmentsBatchResponse = {
  items: Array<{ productGid: string; fitments: Fitment[] }>;
};

export default function FitmentsAssignPage() {
  // Search/paging state
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Product & fitments state
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Map of productGid => fitments[]
  const [fitmentsByProduct, setFitmentsByProduct] = useState<Record<string, Fitment[]>>({});

  const fetchProducts = useCallback(async (append = false) => {
    setLoading(true);
    try {
      const url = new URL('/api/admin/products', window.location.origin);
      // If your products route expects different param names, adjust:
      if (q.trim()) url.searchParams.set('q', q.trim());
      if (cursor) url.searchParams.set('after', cursor);
      url.searchParams.set('first', '20');

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as ProductsResponse;

      const nodes = (json.products?.edges ?? []).map(e => e.node);
      setProducts(prev => (append ? [...prev, ...nodes] : nodes));
      const pi = json.products?.pageInfo;
      setHasNext(Boolean(pi?.hasNextPage));
      setNextCursor(pi?.endCursor ?? null);

      // Batch-fetch fitments for these products
      const gids = nodes.map(n => n.id);
      if (gids.length) {
        const batch = await fetch('/api/admin/fitments/by-products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productGids: gids }),
        });
        if (batch.ok) {
          const data = (await batch.json()) as FitmentsBatchResponse;
          const merged: Record<string, Fitment[]> = {};
          for (const item of data.items) merged[item.productGid] = item.fitments;
          setFitmentsByProduct(prev => ({ ...prev, ...merged }));
        }
      }
    } catch (e) {
      console.error('fetchProducts error', e);
    } finally {
      setLoading(false);
    }
  }, [q, cursor]);

  useEffect(() => {
    // initial load
    fetchProducts(false);
  }, [fetchProducts]);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setCursor(null);
    await fetchProducts(false);
  };

  const loadMore = async () => {
    if (!hasNext || !nextCursor) return;
    setCursor(nextCursor);
    await fetchProducts(true);
  };

  // Helpers
  function imgUrl(p: ProductNode): string {
    return p.featuredImage?.url || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif';
  }

  async function addFitment(productGid: string, f: Omit<Fitment, 'id' | 'productGid'>) {
    // POST /api/admin/fitments
    const res = await fetch('/api/admin/fitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productGid, ...f }),
    });
    if (!res.ok) {
      alert(`Add fitment failed: ${await res.text()}`);
      return;
    }
    // Refresh that product’s fitments
    await refreshFitments(productGid);
  }

  async function deleteFitment(id: string, productGid: string) {
    const res = await fetch('/api/admin/fitments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      alert(`Delete fitment failed: ${await res.text()}`);
      return;
    }
    await refreshFitments(productGid);
  }

  async function refreshFitments(productGid: string) {
    const res = await fetch(`/api/fitments?productGid=${encodeURIComponent(productGid)}`, { cache: 'no-store' });
    if (!res.ok) return;
    const rows = (await res.json()) as Fitment[];
    setFitmentsByProduct(prev => ({ ...prev, [productGid]: rows }));
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Assign Fitments (Year/Make/Model) — Product List</h1>
      <p className="text-gray-700 mt-1">
        Browse products, then add/remove fitments inline. No product IDs required.
      </p>

      <form onSubmit={onSearch} className="mt-4 flex gap-2">
        <input
          className="border rounded px-3 py-2 w-full max-w-md"
          placeholder="Search products (title, handle, etc.)"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button
          type="submit"
          className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Search
        </button>
      </form>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            fitments={fitmentsByProduct[p.id] ?? []}
            onAdd={addFitment}
            onDelete={deleteFitment}
          />
        ))}
      </div>

      <div className="mt-6">
        {hasNext ? (
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-4 py-2 rounded border text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : (
          <div className="text-gray-600">No more products.</div>
        )}
      </div>
    </div>
  );
}

function ProductCard({
  product,
  fitments,
  onAdd,
  onDelete,
}: {
  product: ProductNode;
  fitments: Fitment[];
  onAdd: (productGid: string, f: Omit<Fitment, 'id' | 'productGid'>) => Promise<void>;
  onDelete: (id: string, productGid: string) => Promise<void>;
}) {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [yearFrom, setYearFrom] = useState<string>('');
  const [yearTo, setYearTo] = useState<string>('');
  const [trim, setTrim] = useState('');
  const [chassis, setChassis] = useState('');

  const canAdd = useMemo(() => make.trim() && model.trim(), [make, model]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;

    // Coerce years
    const yf = yearFrom.trim() ? Number(yearFrom) : null;
    const yt = yearTo.trim() ? Number(yearTo) : null;

    await onAdd(product.id, {
      make: make.trim(),
      model: model.trim(),
      yearFrom: Number.isFinite(yf as number) ? (yf as number) : null,
      yearTo: Number.isFinite(yt as number) ? (yt as number) : null,
      trim: trim.trim() ? trim.trim() : null,
      chassis: chassis.trim() ? chassis.trim() : null,
    });

    // Reset
    setMake(''); setModel('');
    setYearFrom(''); setYearTo('');
    setTrim(''); setChassis('');
  };

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.featuredImage?.url || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif'}
          alt={product.title}
          className="h-16 w-16 rounded border object-cover"
        />
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 truncate">{product.title}</div>
          <div className="text-sm text-gray-600 truncate">{product.handle}</div>
        </div>
      </div>

      {/* Existing fitments */}
      <div className="mt-3 flex flex-wrap gap-2">
        {fitments.length === 0 ? (
          <span className="text-sm text-gray-500">No fitments yet</span>
        ) : fitments.map(f => (
          <span
            key={f.id}
            className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-sm text-gray-800"
            title={`Trim: ${f.trim ?? '-'} | Chassis: ${f.chassis ?? '-'}`}
          >
            {f.make} {f.model}
            {f.yearFrom ? ` ${f.yearFrom}` : ''}{f.yearTo ? `–${f.yearTo}` : ''}
            <button
              onClick={() => onDelete(f.id, f.productGid)}
              className="ml-1 rounded px-1 text-red-600 hover:bg-red-50"
              aria-label="Delete fitment"
              title="Delete fitment"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Add new fitment */}
      <form onSubmit={submit} className="mt-3 grid grid-cols-6 gap-2">
        <input
          className="col-span-2 border rounded px-2 py-1"
          placeholder="Make"
          value={make}
          onChange={e => setMake(e.target.value)}
        />
        <input
          className="col-span-2 border rounded px-2 py-1"
          placeholder="Model"
          value={model}
          onChange={e => setModel(e.target.value)}
        />
        <input
          className="col-span-1 border rounded px-2 py-1"
          placeholder="Year from"
          inputMode="numeric"
          value={yearFrom}
          onChange={e => setYearFrom(e.target.value)}
        />
        <input
          className="col-span-1 border rounded px-2 py-1"
          placeholder="Year to"
          inputMode="numeric"
          value={yearTo}
          onChange={e => setYearTo(e.target.value)}
        />
        <input
          className="col-span-2 border rounded px-2 py-1"
          placeholder="Trim (optional)"
          value={trim}
          onChange={e => setTrim(e.target.value)}
        />
        <input
          className="col-span-2 border rounded px-2 py-1"
          placeholder="Chassis (optional)"
          value={chassis}
          onChange={e => setChassis(e.target.value)}
        />
        <div className="col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={!make.trim() || !model.trim()}
            className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Add fitment
          </button>
        </div>
      </form>
    </div>
  );
}
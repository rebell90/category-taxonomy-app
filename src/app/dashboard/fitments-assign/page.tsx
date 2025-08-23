'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ---------- Types ----------
type ProductNode = {
  id: string; // gid://shopify/Product/...
  handle: string;
  title: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | string;
  onlineStoreUrl?: string | null;
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

// ---------- Page ----------
export default function FitmentsAssignPage() {
  // query/paging
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  // data
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [fitmentsByProduct, setFitmentsByProduct] = useState<Record<string, Fitment[]>>({});

// add near other state:
const [errText, setErrText] = useState<string | null>(null);

const fetchProducts = useCallback(
  async (append: boolean) => {
    setLoading(true);
    setErrText(null);
    try {
      // ---- Try GET first
      const getUrl = new URL('/api/admin/products', window.location.origin);
      if (q.trim()) getUrl.searchParams.set('q', q.trim());
      if (cursor) getUrl.searchParams.set('after', cursor);
      getUrl.searchParams.set('first', '20');

      let res = await fetch(getUrl.toString(), { cache: 'no-store' });

      // ---- If GET failed (404/405/etc), try POST fallback
      if (!res.ok) {
        const postBody = { q: q.trim(), first: 20, after: cursor };
        res = await fetch('/api/admin/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody),
        });
      }

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Products API ${res.status}: ${t.slice(0, 300)}`);
      }

      const json = (await res.json()) as ProductsResponse;

      // Accept a couple shapes people commonly return
      const edges = json.products?.edges
        ?? (json as any).edges
        ?? [];

      const pageInfo = json.products?.pageInfo
        ?? (json as any).pageInfo
        ?? { hasNextPage: false, endCursor: null };

      const nodes = edges.map((e: { node: ProductNode }) => e.node);
      setProducts(prev => (append ? [...prev, ...nodes] : nodes));
      setHasNext(Boolean(pageInfo.hasNextPage));
      setNextCursor(pageInfo.endCursor ?? null);

      // Batch-load fitments for visible nodes
      if (nodes.length) {
        const batch = await fetch('/api/admin/fitments/by-products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productGids: nodes.map(n => n.id) }),
        });

        if (batch.ok) {
          const data = (await batch.json()) as {
            items: Array<{ productGid: string; fitments: Fitment[] }>;
          };
          const merged: Record<string, Fitment[]> = {};
          for (const item of data.items) merged[item.productGid] = item.fitments;
          setFitmentsByProduct(prev => ({ ...prev, ...merged }));
        } else {
          // non-fatal
          console.warn('fitments/by-products failed', await batch.text());
        }
      }
    } catch (err) {
      console.error('fetchProducts error', err);
      setErrText(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  },
  [q, cursor]
);

  useEffect(() => {
    fetchProducts(false);
  }, [fetchProducts]);

  const filteredProducts = useMemo(() => {
    if (!onlyUnassigned) return products;
    return products.filter(p => (fitmentsByProduct[p.id] ?? []).length === 0);
  }, [onlyUnassigned, products, fitmentsByProduct]);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setCursor(null);
    await fetchProducts(false);
  };

  const refreshFitments = useCallback(async (productGid: string) => {
    const res = await fetch(`/api/fitments?productGid=${encodeURIComponent(productGid)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const rows = (await res.json()) as Fitment[];
    setFitmentsByProduct(prev => ({ ...prev, [productGid]: rows }));
  }, []);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-2xl font-bold text-gray-900">Products + Fitments View</h1>
      <p className="mt-1 text-gray-700">
        Assign Year / Make / Model (and optional Trim / Chassis) inline, or filter for unassigned products.
      </p>

      {/* Controls */}
      <form onSubmit={onSearch} className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-gray-900">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={onlyUnassigned}
            onChange={e => setOnlyUnassigned(e.target.checked)}
          />
          Show only unassigned
        </label>
        <input
          className="w-full max-w-md rounded border px-3 py-2 text-gray-900 placeholder-gray-500"
          placeholder="Search title / handle / slug…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button
          type="submit"
          className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-black"
        >
          Refresh
        </button>
      </form>

      {/* Table */}
      <div className="mt-5 overflow-hidden rounded-xl border bg-white">
        <div className="grid grid-cols-12 border-b bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900">
          <div className="col-span-5">Product</div>
          <div className="col-span-3">Current Fitments</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1">Admin</div>
          <div className="col-span-2">Assign Fitment</div>
        </div>

        {filteredProducts.map(p => (
          <Row
            key={p.id}
            product={p}
            fitments={fitmentsByProduct[p.id] ?? []}
            onDeleted={() => refreshFitments(p.id)}
            onAdded={() => refreshFitments(p.id)}
          />
        ))}

        {filteredProducts.length === 0 && (
          <div className="px-6 py-10 text-center text-gray-700">No products.</div>
        )}
      </div>

      <div className="mt-6">
        {hasNext ? (
          <button
            onClick={async () => {
              if (!hasNext || !nextCursor) return;
              setCursor(nextCursor);
              await fetchProducts(true);
            }}
            disabled={loading}
            className="rounded border px-4 py-2 text-gray-900 hover:bg-gray-50 disabled:opacity-50"
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

// ---------- Row ----------
function Row({
  product,
  fitments,
  onAdded,
  onDeleted,
}: {
  product: ProductNode;
  fitments: Fitment[];
  onAdded: () => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}) {
  // add form
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [trim, setTrim] = useState('');
  const [chassis, setChassis] = useState('');
  const canAdd = make.trim() !== '' && model.trim() !== '';

  // helpers
  const img = product.featuredImage?.url || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif';
  const status = (product.status ?? 'ACTIVE').toUpperCase();

  async function addFitment(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdd) return;

    const yf = yearFrom.trim() ? Number(yearFrom) : null;
    const yt = yearTo.trim() ? Number(yearTo) : null;

    const res = await fetch('/api/admin/fitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productGid: product.id,
        make: make.trim(),
        model: model.trim(),
        yearFrom: Number.isFinite(yf as number) ? (yf as number) : null,
        yearTo: Number.isFinite(yt as number) ? (yt as number) : null,
        trim: trim.trim() ? trim.trim() : null,
        chassis: chassis.trim() ? chassis.trim() : null,
      }),
    });

    if (!res.ok) {
      alert(`Add fitment failed: ${await res.text()}`);
      return;
    }

    // reset + refresh
    setMake('');
    setModel('');
    setYearFrom('');
    setYearTo('');
    setTrim('');
    setChassis('');
    await onAdded();
  }

  async function removeFitment(id: string) {
    const res = await fetch('/api/admin/fitments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      alert(`Delete fitment failed: ${await res.text()}`);
      return;
    }
    await onDeleted();
  }

  return (
    <div className="grid grid-cols-12 items-start border-b px-4 py-4 text-sm last:border-b-0">
      {/* Product */}
      <div className="col-span-5 flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={product.title} className="h-14 w-14 rounded border object-cover" />
        <div className="min-w-0">
          <div className="truncate font-semibold text-gray-900">{product.title}</div>
          <div className="truncate text-gray-600">@{product.handle}</div>
        </div>
      </div>

      {/* Current Fitments */}
      <div className="col-span-3">
        {fitments.length === 0 ? (
          <span className="rounded border px-2 py-1 text-gray-600">None</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {fitments.map(f => (
              <span
                key={f.id}
                className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-gray-800"
                title={`Trim: ${f.trim ?? '-'} | Chassis: ${f.chassis ?? '-'}`}
              >
                {f.make} {f.model}
                {f.yearFrom ? ` ${f.yearFrom}` : ''}{f.yearTo ? `–${f.yearTo}` : ''}
                <button
                  onClick={() => removeFitment(f.id)}
                  className="ml-1 rounded px-1 text-red-600 hover:bg-red-50"
                  aria-label="Delete fitment"
                  title="Delete fitment"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Status */}
      <div className="col-span-1">
        <span
          className={`rounded px-2 py-1 ${
            status === 'ACTIVE'
              ? 'border border-green-200 bg-green-50 text-green-800'
              : 'border border-gray-200 bg-gray-50 text-gray-700'
          }`}
        >
          {status}
        </span>
      </div>

      {/* Admin */}
      <div className="col-span-1">
        <Link
          href={`/products/${product.handle}`}
          target="_blank"
          className="text-indigo-700 hover:underline"
        >
          Open
        </Link>
      </div>

      {/* Assign Fitment */}
      <div className="col-span-2">
        <form onSubmit={addFitment} className="grid grid-cols-2 gap-2">
          <input
            className="col-span-2 rounded border px-2 py-1"
            placeholder="Make"
            value={make}
            onChange={e => setMake(e.target.value)}
          />
          <input
            className="col-span-2 rounded border px-2 py-1"
            placeholder="Model"
            value={model}
            onChange={e => setModel(e.target.value)}
          />
          <input
            className="rounded border px-2 py-1"
            placeholder="Year from"
            inputMode="numeric"
            value={yearFrom}
            onChange={e => setYearFrom(e.target.value)}
          />
          <input
            className="rounded border px-2 py-1"
            placeholder="Year to"
            inputMode="numeric"
            value={yearTo}
            onChange={e => setYearTo(e.target.value)}
          />
          <input
            className="col-span-2 rounded border px-2 py-1"
            placeholder="Trim (optional)"
            value={trim}
            onChange={e => setTrim(e.target.value)}
          />
          <input
            className="col-span-2 rounded border px-2 py-1"
            placeholder="Chassis (optional)"
            value={chassis}
            onChange={e => setChassis(e.target.value)}
          />
          <button
            type="submit"
            disabled={!canAdd}
            className="col-span-2 rounded bg-green-600 px-3 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Assign Fitment
          </button>
        </form>
      </div>
    </div>
  );
}
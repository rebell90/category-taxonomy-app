'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

// ---------- Types ----------

type ProductNode = {
  id: string; // gid://shopify/Product/...
  handle: string;
  title: string;
  featuredImage?: { url: string; altText?: string | null } | null;
};

type GraphPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type GraphEdge = { node: ProductNode };
type GraphConnection = { edges: GraphEdge[]; pageInfo: GraphPageInfo };

type ProductsAuditResponse =
  | { products: GraphConnection } // preferred shape
  | { edges: GraphEdge[]; pageInfo: GraphPageInfo } // alt shape
  | { products: ProductNode[] }; // flattened fallback

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

type FitmentsListResponse = {
  items: Fitment[];
};

type FitmentCreatePayload = {
  productGid: string;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
};

// ---------- Helpers ----------

function normalizeProducts(json: ProductsAuditResponse): { nodes: ProductNode[]; pageInfo: GraphPageInfo } {
  // Shape 1: { products: { edges, pageInfo } }
  if ('products' in json && (json as { products: unknown }).products && typeof (json as { products: unknown }).products === 'object') {
    const conn = (json as { products: GraphConnection }).products;
    const nodes = conn.edges.map((e) => e.node);
    return { nodes, pageInfo: conn.pageInfo };
  }

  // Shape 2: { edges, pageInfo }
  if ('edges' in json && Array.isArray((json as { edges: GraphEdge[] }).edges)) {
    const edges = (json as { edges: GraphEdge[] }).edges;
    const pageInfo = (json as { pageInfo?: GraphPageInfo }).pageInfo ?? { hasNextPage: false, endCursor: null };
    const nodes = edges.map((e) => e.node);
    return { nodes, pageInfo };
  }

  // Shape 3: { products: ProductNode[] }
  if ('products' in json && Array.isArray((json as { products: ProductNode[] }).products)) {
    const nodes = (json as { products: ProductNode[] }).products;
    return { nodes, pageInfo: { hasNextPage: false, endCursor: null } };
  }

  // Fallback
  return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

function toIntOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------- UI ----------

export default function FitmentsAuditPage() {
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Per-product fitments cache and in-row editor state
  const [fitmentsByProduct, setFitmentsByProduct] = useState<Record<string, Fitment[]>>({});
  const [editor, setEditor] = useState<
    Record<
      string,
      {
        make: string;
        model: string;
        yearFrom: string;
        yearTo: string;
        trim: string;
        chassis: string;
        saving: boolean;
        error: string | null;
      }
    >
  >({});

  const pageTitle = useMemo(() => 'Products ↔ Fitments', []);

  async function loadProducts(append = false) {
    setLoading(true);
    setErr(null);
    try {
      const url = new URL('/api/admin/products-audit', location.origin);
      url.searchParams.set('first', '24');
      if (after) url.searchParams.set('after', after);

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Products HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as ProductsAuditResponse;
      const { nodes, pageInfo } = normalizeProducts(json);

      setProducts((prev) => (append ? [...prev, ...nodes] : nodes));
      setHasNext(Boolean(pageInfo.hasNextPage));
      setAfter(pageInfo.endCursor ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initial load
    // after is null intentionally here
    loadProducts(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureFitments(productGid: string) {
    if (fitmentsByProduct[productGid]) return; // cached
    try {
      const url = new URL('/api/fitments', location.origin);
      url.searchParams.set('productGid', productGid);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fitments HTTP ${res.status}`);
      const json = (await res.json()) as FitmentsListResponse;
      setFitmentsByProduct((prev) => ({ ...prev, [productGid]: json.items || [] }));
    } catch (e) {
      // soft-fail: empty list
      setFitmentsByProduct((prev) => ({ ...prev, [productGid]: [] }));
    }
  }

  function startRowEditor(productGid: string) {
    setEditor((prev) => ({
      ...prev,
      [productGid]: { make: '', model: '', yearFrom: '', yearTo: '', trim: '', chassis: '', saving: false, error: null },
    }));
  }

  function updateRowEditor(productGid: string, field: keyof (typeof editor)[string], value: string) {
    setEditor((prev) => {
      const row = prev[productGid];
      if (!row) return prev;
      return { ...prev, [productGid]: { ...row, [field]: value } };
    });
  }

  async function addFitment(productGid: string) {
    const row = editor[productGid];
    if (!row) return;

    const payload: FitmentCreatePayload = {
      productGid,
      make: row.make.trim(),
      model: row.model.trim(),
      yearFrom: toIntOrNull(row.yearFrom),
      yearTo: toIntOrNull(row.yearTo),
      trim: row.trim.trim() || null,
      chassis: row.chassis.trim() || null,
    };

    // Basic validation
    if (!payload.make || !payload.model) {
      setEditor((prev) => ({ ...prev, [productGid]: { ...row, error: 'Make and Model are required.' } }));
      return;
    }

    try {
      setEditor((prev) => ({ ...prev, [productGid]: { ...row, saving: true, error: null } }));

      const res = await fetch('/api/admin/fitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Create failed (${res.status})`);
      }

      // Reload product's fitments
      setEditor((prev) => {
        const cur = prev[productGid];
        if (!cur) return prev;
        return { ...prev, [productGid]: { ...cur, saving: false, make: '', model: '', yearFrom: '', yearTo: '', trim: '', chassis: '' } };
      });
      // Force refetch to get canonical ID/shape
      setFitmentsByProduct((prev) => {
        const copy = { ...prev };
        delete copy[productGid];
        return copy;
      });
      await ensureFitments(productGid);
    } catch (e) {
      setEditor((prev) => ({ ...prev, [productGid]: { ...row, saving: false, error: (e as Error).message } }));
    }
  }

  async function deleteFitment(productGid: string, fitmentId: string) {
    if (!confirm('Remove this fitment?')) return;
    try {
      const res = await fetch('/api/admin/fitments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fitmentId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Delete failed (${res.status})`);
      }
      // Optimistically update cache
      setFitmentsByProduct((prev) => {
        const list = prev[productGid] || [];
        return { ...prev, [productGid]: list.filter((f) => f.id !== fitmentId) };
      });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{pageTitle}</h1>
      <p className="text-gray-700 mb-4">
        Assign <span className="font-medium">Year / Make / Model / (Trim / Chassis optional)</span> to each product. These drive your public YMM filter.
      </p>

      {err && <div className="mb-3 rounded-md border border-red-200 bg-red-50 text-red-800 p-3">{err}</div>}

      <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-[96px_1fr_1.1fr] gap-0 text-sm font-semibold border-b bg-gray-50 text-gray-800">
          <div className="px-3 py-2">Image</div>
          <div className="px-3 py-2">Product</div>
          <div className="px-3 py-2">Fitments</div>
        </div>

        {/* Rows */}
        {products.length === 0 && !loading && (
          <div className="p-4 text-gray-700">No Products Found.</div>
        )}

        {products.map((p) => {
          const img = p.featuredImage?.url ?? '';
          const fitments = fitmentsByProduct[p.id];
          const row = editor[p.id];

          return (
            <div key={p.id} className="grid grid-cols-[96px_1fr_1.1fr] gap-0 border-b last:border-b-0">
              {/* Image */}
              <div className="px-3 py-3 flex items-center">
                {img ? (
                  <Image
                    src={img}
                    alt={p.title}
                    width={72}
                    height={72}
                    className="rounded-md border object-cover"
                  />
                ) : (
                  <div className="w-[72px] h-[72px] rounded-md border bg-gray-100" />
                )}
              </div>

              {/* Product meta */}
              <div className="px-3 py-3">
                <div className="font-medium text-gray-900">{p.title}</div>
                <div className="text-xs text-gray-600 mt-0.5 break-all">{p.id}</div>
                <div className="text-xs text-blue-700 mt-0.5">
                  <a href={`/products/${p.handle}`} target="_blank" rel="noreferrer">
                    /products/{p.handle}
                  </a>
                </div>
                <button
                  onClick={() => ensureFitments(p.id)}
                  className="mt-2 inline-flex items-center text-xs text-gray-800 border px-2 py-1 rounded hover:bg-gray-50"
                >
                  {fitments ? 'Refresh fitments' : 'Load fitments'}
                </button>
              </div>

              {/* Fitments + editor */}
              <div className="px-3 py-3">
                {/* Existing fitments */}
                <div className="space-y-2">
                  {(fitments || []).map((f) => (
                    <div key={f.id} className="flex items-center justify-between border rounded-md px-2 py-1">
                      <div className="text-sm text-gray-900">
                        <span className="font-medium">{f.make}</span> {f.model}
                        {f.trim ? ` • ${f.trim}` : ''}
                        {f.chassis ? ` • ${f.chassis}` : ''}
                        {(f.yearFrom || f.yearTo) ? (
                          <span className="text-gray-700">{' '}• {f.yearFrom ?? '—'}–{f.yearTo ?? '—'}</span>
                        ) : null}
                      </div>
                      <button
                        onClick={() => deleteFitment(p.id, f.id)}
                        className="text-xs text-red-700 hover:underline"
                        title="Remove fitment"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  {/* Editor */}
                  {!row ? (
                    <button
                      onClick={() => startRowEditor(p.id)}
                      className="inline-flex items-center text-xs text-gray-800 border px-2 py-1 rounded hover:bg-gray-50"
                    >
                      + Add fitment
                    </button>
                  ) : (
                    <div className="border rounded-md p-2 space-y-2">
                      {row.error && <div className="text-xs text-red-700">{row.error}</div>}
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                        <input
                          className="border rounded px-2 py-1 text-sm text-gray-900"
                          placeholder="Make*"
                          value={row.make}
                          onChange={(e) => updateRowEditor(p.id, 'make', e.target.value)}
                        />
                        <input
                          className="border rounded px-2 py-1 text-sm text-gray-900"
                          placeholder="Model*"
                          value={row.model}
                          onChange={(e) => updateRowEditor(p.id, 'model', e.target.value)}
                        />
                        <input
                          className="border rounded px-2 py-1 text-sm text-gray-900"
                          placeholder="Year From"
                          value={row.yearFrom}
                          onChange={(e) => updateRowEditor(p.id, 'yearFrom', e.target.value)}
                          inputMode="numeric"
                        />
                        <input
                          className="border rounded px-2 py-1 text-sm text-gray-900"
                          placeholder="Year To"
                          value={row.yearTo}
                          onChange={(e) => updateRowEditor(p.id, 'yearTo', e.target.value)}
                          inputMode="numeric"
                        />
                        <input
                          className="border rounded px-2 py-1 text-sm text-gray-900"
                          placeholder="Trim"
                          value={row.trim}
                          onChange={(e) => updateRowEditor(p.id, 'trim', e.target.value)}
                        />
                        <input
                          className="border rounded px-2 py-1 text-sm text-gray-900"
                          placeholder="Chassis"
                          value={row.chassis}
                          onChange={(e) => updateRowEditor(p.id, 'chassis', e.target.value)}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => addFitment(p.id)}
                          disabled={row.saving}
                          className="bg-blue-700 hover:bg-blue-800 text-white text-sm px-3 py-1.5 rounded"
                        >
                          {row.saving ? 'Saving…' : 'Save fitment'}
                        </button>
                        <button
                          onClick={() =>
                            setEditor((prev) => {
                              const copy = { ...prev };
                              delete copy[p.id];
                              return copy;
                            })
                          }
                          className="text-sm border px-3 py-1.5 rounded text-gray-800 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => loadProducts(true)}
          disabled={!hasNext || loading}
          className="border px-4 py-2 rounded text-gray-900 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : hasNext ? 'Load more' : 'No more'}
        </button>
      </div>
    </main>
  );
}
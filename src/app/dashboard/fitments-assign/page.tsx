'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';

// ---------- Types ----------
type ProductStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

type ProductImage = { url: string | null };

type ProductNode = {
  id: string;          // Admin GID (gid://shopify/Product/123)
  handle: string;
  title: string;
  status: ProductStatus;
  featuredImage?: ProductImage | null;
};

type Edge<T> = { node: T; cursor?: string | null };

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

type ProductsResponse =
  | { products: { edges: Array<Edge<ProductNode>>; pageInfo: PageInfo } }
  | { edges: Array<Edge<ProductNode>>; pageInfo: PageInfo };

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

type FitmentsResponse = { items: Fitment[] };

type CreateFitmentPayload = {
  productGid: string;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
};

type DeleteFitmentPayload = { id: string };

// ---------- Helpers ----------
function isProductNode(v: unknown): v is ProductNode {
  return typeof v === 'object' && v !== null && 'id' in v && 'handle' in v && 'title' in v;
}

function isEdgeArray(v: unknown): v is Array<{ node: unknown; cursor?: unknown }> {
  return Array.isArray(v) && v.every(e => typeof e === 'object' && e !== null && 'node' in e);
}

function asPageInfo(v: unknown): PageInfo {
  const hasNextPage =
    typeof (v as { hasNextPage?: unknown })?.hasNextPage === 'boolean'
      ? (v as { hasNextPage: boolean }).hasNextPage
      : false;

  const endCursorRaw = (v as { endCursor?: unknown })?.endCursor;
  const endCursor =
    typeof endCursorRaw === 'string' || endCursorRaw === null || endCursorRaw === undefined
      ? (endCursorRaw ?? null)
      : null;

  return { hasNextPage, endCursor };
}

/** Accepts different shapes from our products API and normalizes to nodes + pageInfo */
function parseProductsResponse(json: unknown): { nodes: ProductNode[]; pageInfo: PageInfo } {
  const products = (json as { products?: unknown })?.products;
  if (products && typeof products === 'object') {
    const edges = (products as { edges?: unknown }).edges;
    if (isEdgeArray(edges)) {
      const nodes = edges.map(e => e.node).filter(isProductNode);
      return { nodes, pageInfo: asPageInfo((products as { pageInfo?: unknown }).pageInfo) };
    }
    const nodesArr = (products as { nodes?: unknown }).nodes;
    if (Array.isArray(nodesArr)) {
      const nodes = (nodesArr as unknown[]).filter(isProductNode);
      return { nodes, pageInfo: asPageInfo((products as { pageInfo?: unknown }).pageInfo) };
    }
  }

  const edgesB = (json as { edges?: unknown }).edges;
  if (isEdgeArray(edgesB)) {
    const nodes = edgesB.map(e => e.node).filter(isProductNode);
    return { nodes, pageInfo: asPageInfo((json as { pageInfo?: unknown }).pageInfo) };
  }

  return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

function emptyToNull(s?: string | null): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  return t.length ? t : null;
}

function toIntOrNull(s?: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function statusBadgeColor(status: ProductStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-700';
    case 'DRAFT':
      return 'bg-yellow-100 text-yellow-800';
    case 'ARCHIVED':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-200 text-gray-700';
  }
}

// ---------- Page ----------
export default function FitmentsDashboardPage() {
  // UI state
  const [search, setSearch] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // pagination
  const [hasNext, setHasNext] = useState(false);
  const [endCursor, setEndCursor] = useState<string | null>(null);

  // per-product fitments + form state
  const [fitmentsByProduct, setFitmentsByProduct] = useState<Record<string, Fitment[]>>({});
  const [formByProduct, setFormByProduct] = useState<Record<
    string,
    { make: string; model: string; yearFrom: string; yearTo: string; trim: string; chassis: string }
  >>({});

  // initial per-product form defaults
  const ensureForm = useCallback((pid: string) => {
    setFormByProduct(prev => {
      if (prev[pid]) return prev;
      return { ...prev, [pid]: { make: '', model: '', yearFrom: '', yearTo: '', trim: '', chassis: '' } };
    });
  }, []);

  // Fetch products (paged)
  const fetchProducts = useCallback(
    async (opts: { append: boolean } = { append: false }) => {
      try {
        setErrorText(null);
        opts.append ? setLoadingMore(true) : setLoading(true);

        const params = new URLSearchParams();
        params.set('first', '25');
        if (opts.append && endCursor) params.set('after', endCursor);
        if (search.trim()) params.set('query', search.trim());

        const res = await fetch(`/api/admin/products?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json: unknown = await res.json();
        const { nodes, pageInfo } = parseProductsResponse(json);

        setProducts(prev => (opts.append ? [...prev, ...nodes] : nodes));
        setHasNext(pageInfo.hasNextPage);
        setEndCursor(pageInfo.endCursor);

        // kick off fitment fetch for newly loaded nodes
        for (const p of nodes) {
          void fetchFitmentsFor(p.id);
          ensureForm(p.id);
        }
      } catch (err) {
        setErrorText((err as Error).message || 'Failed to load products');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [endCursor, search, ensureForm]
  );

  // Fetch fitments for a product
  const fetchFitmentsFor = useCallback(async (productGid: string) => {
    try {
      const url = `/api/fitments?productGid=${encodeURIComponent(productGid)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fitments HTTP ${res.status}`);
      const data = (await res.json()) as FitmentsResponse;
      setFitmentsByProduct(prev => ({ ...prev, [productGid]: data.items }));
    } catch (err) {
      // keep row usable even if fitments fail
      setFitmentsByProduct(prev => ({ ...prev, [productGid]: [] }));
    }
  }, []);

  // first load
  useEffect(() => {
    void fetchProducts({ append: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // handlers
  const onRefresh = () => {
    setEndCursor(null);
    void fetchProducts({ append: false });
  };

  const onLoadMore = () => void fetchProducts({ append: true });

  const onFieldChange = (pid: string, field: keyof (typeof formByProduct)[string], value: string) => {
    setFormByProduct(prev => ({ ...prev, [pid]: { ...prev[pid], [field]: value } }));
  };

  const assignFitment = async (pid: string) => {
    const f = formByProduct[pid];
    if (!f) return;

    const payload: CreateFitmentPayload = {
      productGid: pid,
      make: f.make.trim(),
      model: f.model.trim(),
      yearFrom: toIntOrNull(f.yearFrom) ?? undefined,
      yearTo: toIntOrNull(f.yearTo) ?? undefined,
      trim: emptyToNull(f.trim) ?? undefined,
      chassis: emptyToNull(f.chassis) ?? undefined,
    };

    if (!payload.make || !payload.model) {
      alert('Make and Model are required');
      return;
    }

    const res = await fetch('/api/admin/fitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = await res.text();
      alert(`Assign failed: ${msg}`);
      return;
    }

    // clear line + refresh list
    setFormByProduct(prev => ({
      ...prev,
      [pid]: { make: '', model: '', yearFrom: '', yearTo: '', trim: '', chassis: '' },
    }));
    await fetchFitmentsFor(pid);
  };

  const deleteFitment = async (pid: string, id: string) => {
    if (!confirm('Remove this fitment?')) return;
    const res = await fetch('/api/admin/fitments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id } satisfies DeleteFitmentPayload),
    });
    if (!res.ok) {
      const msg = await res.text();
      alert(`Delete failed: ${msg}`);
      return;
    }
    await fetchFitmentsFor(pid);
  };

  // computed: filtered rows if "only unassigned"
  const rows = useMemo(() => {
    if (!onlyUnassigned) return products;
    return products.filter(p => {
      const f = fitmentsByProduct[p.id];
      return !f || f.length === 0;
    });
  }, [onlyUnassigned, products, fitmentsByProduct]);

  // ---------- UI ----------
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Products + Fitments</h1>
      <p className="text-gray-600 mt-1">
        Assign Year/Make/Model (and optional Trim/Chassis) to products. Use the search to narrow the list.
      </p>

      <section className="mt-5 rounded-xl border border-gray-200 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-center p-4 border-b border-gray-200">
          <label className="inline-flex items-center gap-2 text-gray-800">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={onlyUnassigned}
              onChange={(e) => setOnlyUnassigned(e.target.checked)}
            />
            Show only unassigned
          </label>

          <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title / handle…"
              className="w-72 max-w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={onRefresh}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Error */}
        {errorText && (
          <div className="px-4 py-3 text-sm text-red-700 bg-red-50 border-b border-red-200">
            {errorText}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Product</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Current Fitments</th>
                <th className="px-4 py-3 text-left font-semibold w-[520px]">Add Fitment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((p) => {
                const fitments = fitmentsByProduct[p.id] ?? [];
                const form = formByProduct[p.id] ?? {
                  make: '',
                  model: '',
                  yearFrom: '',
                  yearTo: '',
                  trim: '',
                  chassis: '',
                };

                return (
                  <tr key={p.id} className="align-top">
                    {/* Product */}
                    <td className="px-4 py-4">
                      <div className="flex gap-3">
                        <div className="h-16 w-16 rounded-md overflow-hidden bg-gray-100 border border-gray-200 relative">
                          {p.featuredImage?.url ? (
                            <Image
                              src={p.featuredImage.url}
                              alt={p.title}
                              fill
                              className="object-cover"
                              sizes="64px"
                              priority={false}
                            />
                          ) : (
                            <div className="h-full w-full grid place-items-center text-xs text-gray-400">No image</div>
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{p.title}</div>
                          <div className="text-xs text-gray-500">@{p.handle}</div>
                          <div className="mt-1">
                            <a
                              className="text-blue-600 hover:underline text-xs"
                              href={`https://admin.shopify.com/store/${process.env.NEXT_PUBLIC_SHOP || ''}/products/${encodeURIComponent(
                                p.id
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in Admin
                            </a>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${statusBadgeColor(
                          p.status
                        )}`}
                      >
                        {p.status}
                      </span>
                    </td>

                    {/* Current Fitments */}
                    <td className="px-4 py-4">
                      {fitments.length === 0 ? (
                        <span className="text-gray-500">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {fitments.map((f) => (
                            <span
                              key={f.id}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                              title={[
                                f.make,
                                f.model,
                                f.yearFrom ? ` ${f.yearFrom}` : '',
                                f.yearTo ? `–${f.yearTo}` : '',
                                f.trim ? ` • ${f.trim}` : '',
                                f.chassis ? ` • ${f.chassis}` : '',
                              ].join('')}
                            >
                              {f.make} {f.model}
                              {f.yearFrom ? ` ${f.yearFrom}` : ''}
                              {f.yearTo ? `–${f.yearTo}` : ''}
                              <button
                                onClick={() => deleteFitment(p.id, f.id)}
                                className="ml-1 rounded bg-white/60 px-1 text-gray-600 hover:text-red-700"
                                aria-label="Remove fitment"
                                title="Remove"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Add Fitment */}
                    <td className="px-4 py-4">
                      <div className="grid grid-cols-6 gap-2">
                        <input
                          className="col-span-2 rounded-md border border-gray-300 px-2 py-1 text-gray-900"
                          placeholder="Make (req)"
                          value={form.make}
                          onChange={(e) => onFieldChange(p.id, 'make', e.target.value)}
                        />
                        <input
                          className="col-span-2 rounded-md border border-gray-300 px-2 py-1 text-gray-900"
                          placeholder="Model (req)"
                          value={form.model}
                          onChange={(e) => onFieldChange(p.id, 'model', e.target.value)}
                        />
                        <input
                          className="col-span-1 rounded-md border border-gray-300 px-2 py-1 text-gray-900"
                          placeholder="Year from"
                          value={form.yearFrom}
                          onChange={(e) => onFieldChange(p.id, 'yearFrom', e.target.value)}
                        />
                        <input
                          className="col-span-1 rounded-md border border-gray-300 px-2 py-1 text-gray-900"
                          placeholder="Year to"
                          value={form.yearTo}
                          onChange={(e) => onFieldChange(p.id, 'yearTo', e.target.value)}
                        />
                        <input
                          className="col-span-2 rounded-md border border-gray-300 px-2 py-1 text-gray-900"
                          placeholder="Trim (optional)"
                          value={form.trim}
                          onChange={(e) => onFieldChange(p.id, 'trim', e.target.value)}
                        />
                        <input
                          className="col-span-2 rounded-md border border-gray-300 px-2 py-1 text-gray-900"
                          placeholder="Chassis (optional)"
                          value={form.chassis}
                          onChange={(e) => onFieldChange(p.id, 'chassis', e.target.value)}
                        />
                        <div className="col-span-6">
                          <button
                            onClick={() => assignFitment(p.id)}
                            className="rounded-md bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700"
                          >
                            Add Fitment
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && !loading && (
                <tr>
                  <td className="px-4 py-10 text-center text-gray-500" colSpan={4}>
                    {onlyUnassigned ? 'No unassigned products found.' : 'No products found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer / pagination */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            Showing {rows.length} of {products.length} loaded.
          </div>
          <div className="flex items-center gap-2">
            {hasNext && (
              <button
                onClick={onLoadMore}
                className="rounded-md bg-gray-100 px-3 py-2 text-gray-800 hover:bg-gray-200"
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
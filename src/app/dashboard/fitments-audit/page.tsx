'use client';

import { useEffect, useMemo, useState } from 'react';

//
// ===== Types =====
//

type ProductNode = {
  id: string;               // e.g., gid://shopify/Product/123
  title: string;
  handle: string;
  featuredImage?: { url: string; altText?: string | null } | null;
};

type ProductsResponse = {
  products: {
    edges: Array<{ node: ProductNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type Fitment = {
  id: string;
  productGid: string;
  make: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  trim?: string | null;
  chassis?: string | null;
};

type FitTermsTreeResp = {
  rows: FitTermRow[];
  tree: FitTermRow[];
};

type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

type FitTermRow = {
  id: string;
  type: FitTermType;
  name: string;
  parentId: string | null;
};

//
// ===== Helpers (no any) =====
//

// Safely coerce unknown server JSON into our expected shape (without `any`)
function coerceProducts(json: unknown): { nodes: ProductNode[]; hasNext: boolean; endCursor: string | null } {
  // Try the canonical shape
  const maybe = json as Partial<ProductsResponse>;
  const edgesA = maybe?.products?.edges;
  const pageInfoA = maybe?.products?.pageInfo;
  if (Array.isArray(edgesA) && pageInfoA && typeof pageInfoA.hasNextPage === 'boolean') {
    const nodes = edgesA.map(e => e.node).filter(Boolean) as ProductNode[];
    return { nodes, hasNext: pageInfoA.hasNextPage, endCursor: pageInfoA.endCursor ?? null };
  }

  // Common alternative shapes (defensive but typed)
  // { edges: [{ node }], pageInfo: {...} }
  const alt = json as { edges?: Array<{ node: ProductNode }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } };
  if (Array.isArray(alt.edges) && alt.pageInfo && typeof alt.pageInfo.hasNextPage === 'boolean') {
    const nodes = alt.edges.map(e => e.node).filter(Boolean);
    return { nodes, hasNext: Boolean(alt.pageInfo.hasNextPage), endCursor: alt.pageInfo.endCursor ?? null };
  }

  // Fallback empty
  return { nodes: [], hasNext: false, endCursor: null };
}

function numOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

//
// ===== Page =====
//

export default function FitmentsAuditPage() {
  // Products & pagination
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Fit-terms (Make/Model lists for the form)
  const [fitRows, setFitRows] = useState<FitTermRow[]>([]);
  const makes = useMemo(() => fitRows.filter(r => r.type === 'MAKE'), [fitRows]);
  const modelsByParent = useMemo(() => {
    const m = new Map<string, FitTermRow[]>();
    fitRows.filter(r => r.type === 'MODEL' && r.parentId).forEach(r => {
      const parent = r.parentId as string;
      if (!m.has(parent)) m.set(parent, []);
      m.get(parent)!.push(r);
    });
    return m;
  }, [fitRows]);

  // Drawer (side panel) state
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [activeProduct, setActiveProduct] = useState<ProductNode | null>(null);
  const [fitments, setFitments] = useState<Fitment[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  // Add-fitment form fields
  const [selMakeId, setSelMakeId] = useState<string>('');
  const [selModelId, setSelModelId] = useState<string>('');
  const [trim, setTrim] = useState<string>('');
  const [chassis, setChassis] = useState<string>('');
  const [yearFrom, setYearFrom] = useState<string>('');
  const [yearTo, setYearTo] = useState<string>('');

  const selectedMake = useMemo(() => fitRows.find(r => r.id === selMakeId) || null, [fitRows, selMakeId]);
  const availableModels = useMemo(() => (selMakeId ? (modelsByParent.get(selMakeId) || []) : []), [modelsByParent, selMakeId]);
  const selectedModel = useMemo(() => availableModels.find(r => r.id === selModelId) || null, [availableModels, selModelId]);

  // Load initial data
  useEffect(() => {
    void loadFitTerms();
    void loadProducts();
  }, []);

  async function loadFitTerms() {
    try {
      const res = await fetch('/api/fit-terms', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fit terms HTTP ${res.status}`);
      const json = (await res.json()) as FitTermsTreeResp;
      setFitRows(json.rows || []);
    } catch (e: unknown) {
      console.error(e);
      // Non-fatal
    }
  }

  async function loadProducts(after?: string | null, append = false) {
    setLoading(true);
    setErr(null);
    try {
      const url = new URL('/api/admin/products', location.origin);
      url.searchParams.set('first', '20');
      if (after) url.searchParams.set('after', after);

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Products HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as unknown;
      const { nodes, hasNext, endCursor } = coerceProducts(json);
      setProducts(prev => (append ? [...prev, ...nodes] : nodes));
      setHasNext(hasNext);
      setNextCursor(endCursor);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function openDrawer(p: ProductNode) {
    setActiveProduct(p);
    setDrawerOpen(true);
    setFormErr(null);
    // reset form
    setSelMakeId('');
    setSelModelId('');
    setTrim('');
    setChassis('');
    setYearFrom('');
    setYearTo('');
    // load existing fitments for product
    await refreshProductFitments(p.id);
  }

  async function refreshProductFitments(productGid: string) {
    try {
      setBusy(true);
      const url = new URL('/api/admin/fitments', location.origin);
      url.searchParams.set('productGid', productGid);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      const json = await res.json();
      const items = Array.isArray(json?.items) ? (json.items as Fitment[]) : [];
      setFitments(items);
    } catch (e) {
      // non-fatal
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddFitment() {
    if (!activeProduct) return;
    setFormErr(null);

    const makeRow = selectedMake;
    const modelRow = selectedModel;
    if (!makeRow || !modelRow) {
      setFormErr('Please choose Make and Model.');
      return;
    }

    const payload = {
      productGid: activeProduct.id,
      make: makeRow.name,
      model: modelRow.name,
      yearFrom: numOrNull(yearFrom),
      yearTo: numOrNull(yearTo),
      trim: trim.trim() || null,
      chassis: chassis.trim() || null,
    };

    try {
      setBusy(true);
      const res = await fetch('/api/admin/fitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Add failed (${res.status})`);
      }
      await refreshProductFitments(activeProduct.id);
      // reset minimal fields for faster adding more
      setTrim('');
      setChassis('');
    } catch (e: unknown) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFitment(id: string) {
    if (!activeProduct) return;
    if (!confirm('Remove this fitment?')) return;
    try {
      setBusy(true);
      const res = await fetch('/api/admin/fitments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Delete failed (${res.status})`);
      }
      await refreshProductFitments(activeProduct.id);
    } catch (e: unknown) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  //
  // ===== Render =====
  //

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Products ⇄ Fitments</h1>
      <p className="text-sm text-gray-700 mb-4">
        Browse products and assign Year/Make/Model (plus optional Trim/Chassis).
      </p>

      {err && <div className="mb-3 text-red-700">{err}</div>}

      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left text-gray-800 px-3 py-2 w-[72px]">Image</th>
              <th className="text-left text-gray-800 px-3 py-2">Product</th>
              <th className="text-left text-gray-800 px-3 py-2">Handle</th>
              <th className="text-left text-gray-800 px-3 py-2">Fitments</th>
              <th className="text-right text-gray-800 px-3 py-2 w-[140px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-700">
                  No products found.
                </td>
              </tr>
            )}

            {products.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="px-3 py-2 align-top">
                  <img
                    className="w-[56px] h-[56px] object-cover rounded border"
                    src={p.featuredImage?.url || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif'}
                    alt={p.featuredImage?.altText || p.title}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="font-medium text-gray-900">{p.title}</div>
                </td>
                <td className="px-3 py-2 align-top">
                  <a
                    href={`/products/${p.handle}`}
                    className="text-blue-700 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {p.handle}
                  </a>
                </td>
                <td className="px-3 py-2 align-top">
                  {/* We don't prefetch per row to keep it snappy; view inside the drawer */}
                  <span className="text-gray-700">—</span>
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <button
                    onClick={() => void openDrawer(p)}
                    className="inline-flex items-center gap-1 bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded"
                  >
                    Manage Fitments
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="p-3 flex items-center justify-between">
          <div className="text-sm text-gray-700">{loading ? 'Loading…' : null}</div>
          <div>
            {hasNext && (
              <button
                onClick={() => void loadProducts(nextCursor, true)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-3 py-1.5 rounded"
              >
                Load more
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Drawer */}
      {drawerOpen && activeProduct && (
        <div className="fixed inset-0 z-40">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Panel */}
          <div className="absolute right-0 top-0 h-full w-full sm:w-[560px] bg-white shadow-xl p-5 overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-sm text-gray-700">Editing:</div>
                <h2 className="text-xl font-semibold text-gray-900">{activeProduct.title}</h2>
                <div className="text-sm text-gray-700">({activeProduct.handle})</div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-gray-700 hover:text-gray-900"
                aria-label="Close"
                type="button"
              >
                ✕
              </button>
            </div>

            {/* Existing fitments */}
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Current Fitments</h3>
            <div className="mb-4">
              {busy && <div className="text-gray-700 mb-2">Loading…</div>}
              {!busy && fitments.length === 0 && (
                <div className="text-gray-700">None yet.</div>
              )}
              <ul className="space-y-2">
                {fitments.map(f => (
                  <li key={f.id} className="flex items-center justify-between border rounded-lg p-2">
                    <div className="text-gray-900">
                      <span className="font-medium">
                        {f.make} {f.model}
                      </span>
                      {f.trim ? <span> · {f.trim}</span> : null}
                      {f.chassis ? <span> · {f.chassis}</span> : null}
                      {(f.yearFrom || f.yearTo) && (
                        <span className="text-gray-700">
                          {' '}
                          — {f.yearFrom ?? '…'}–{f.yearTo ?? '…'}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => void handleDeleteFitment(f.id)}
                      className="text-red-700 hover:underline text-sm"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Add form */}
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Add Fitment</h3>
            {formErr && <div className="text-red-700 mb-2">{formErr}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Make */}
              <label className="block">
                <span className="block text-sm text-gray-800 mb-1">Make</span>
                <select
                  className="border rounded-md p-2 w-full text-gray-900"
                  value={selMakeId}
                  onChange={e => {
                    setSelMakeId(e.target.value);
                    setSelModelId('');
                  }}
                >
                  <option value="">— Select —</option>
                  {makes.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>

              {/* Model */}
              <label className="block">
                <span className="block text-sm text-gray-800 mb-1">Model</span>
                <select
                  className="border rounded-md p-2 w-full text-gray-900"
                  value={selModelId}
                  onChange={e => setSelModelId(e.target.value)}
                  disabled={!selMakeId}
                >
                  <option value="">— Select —</option>
                  {availableModels.map(mo => (
                    <option key={mo.id} value={mo.id}>{mo.name}</option>
                  ))}
                </select>
              </label>

              {/* Year From */}
              <label className="block">
                <span className="block text-sm text-gray-800 mb-1">Year From</span>
                <input
                  className="border rounded-md p-2 w-full text-gray-900"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={yearFrom}
                  onChange={e => setYearFrom(e.target.value)}
                  placeholder="e.g., 2012"
                />
              </label>

              {/* Year To */}
              <label className="block">
                <span className="block text-sm text-gray-800 mb-1">Year To</span>
                <input
                  className="border rounded-md p-2 w-full text-gray-900"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={yearTo}
                  onChange={e => setYearTo(e.target.value)}
                  placeholder="e.g., 2016"
                />
              </label>

              {/* Trim */}
              <label className="block">
                <span className="block text-sm text-gray-800 mb-1">Trim (optional)</span>
                <input
                  className="border rounded-md p-2 w-full text-gray-900"
                  value={trim}
                  onChange={e => setTrim(e.target.value)}
                  placeholder="e.g., Si / GT / Base"
                />
              </label>

              {/* Chassis */}
              <label className="block">
                <span className="block text-sm text-gray-800 mb-1">Chassis (optional)</span>
                <input
                  className="border rounded-md p-2 w-full text-gray-900"
                  value={chassis}
                  onChange={e => setChassis(e.target.value)}
                  placeholder="e.g., E90 / GD / ZN6"
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void handleAddFitment()}
                className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded"
                disabled={busy}
              >
                Add
              </button>
              <button
                onClick={() => setDrawerOpen(false)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded"
                disabled={busy}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
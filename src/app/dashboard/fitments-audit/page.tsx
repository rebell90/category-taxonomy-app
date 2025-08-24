'use client';

import React, { useEffect, useMemo, useState } from 'react';

/* =======================
   Types
   ======================= */

type ProductItem = {
  id: string;            // product GID e.g. gid://shopify/Product/123
  title: string;
  handle: string;
  image?: string | null;
  status?: string;
};

type ProductsResponse =
  | {
      items: ProductItem[];
      nextCursor?: string | null;
    }
  // Allow a looser shape if your /api/admin/products returns edges
  | {
      products?: { edges: Array<{ node: ProductItem }>; pageInfo?: { hasNextPage: boolean; endCursor?: string | null } };
      edges?: Array<{ node: ProductItem }>;
      pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
    };

type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

type FitTerm = {
  id: string;
  type: FitTermType;
  name: string;
  parentId: string | null;
};

type FitTermsResp = {
  rows: FitTerm[];
};

type ProductFitment = {
  id: string;
  productGid: string;
  make: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  trim: string | null;
  chassis: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type FitmentsListResp = { fitments: ProductFitment[] };

type UpsertPayload = {
  productGid: string;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
};

type DeletePayload = {
  productGid: string;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
};

/* =======================
   Helpers
   ======================= */

function cls(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

function parseIntOrNull(v?: string): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/* =======================
   Row Editor state
   ======================= */

type RowEditorState = {
  makeId: string;
  modelId: string;
  yearFrom: string; // keep as text input, convert later
  yearTo: string;   // keep as text input, convert later
  trimId: string;
  chassisId: string;
};

/* =======================
   Component
   ======================= */

export default function FitmentsAuditPage() {
  // Products
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fit terms
  const [terms, setTerms] = useState<FitTerm[]>([]);
  const makes = useMemo(() => terms.filter(t => t.type === 'MAKE'), [terms]);
  const modelsByParent = useMemo<Record<string, FitTerm[]>>(() => {
    const out: Record<string, FitTerm[]> = {};
    for (const t of terms) {
      if (t.type === 'MODEL' && t.parentId) {
        if (!out[t.parentId]) out[t.parentId] = [];
        out[t.parentId].push(t);
      }
    }
    return out;
  }, [terms]);
  const trimsByParent = useMemo<Record<string, FitTerm[]>>(() => {
    const out: Record<string, FitTerm[]> = {};
    for (const t of terms) {
      if (t.type === 'TRIM' && t.parentId) {
        if (!out[t.parentId]) out[t.parentId] = [];
        out[t.parentId].push(t);
      }
    }
    return out;
  }, [terms]);
  const chassisByParent = useMemo<Record<string, FitTerm[]>>(() => {
    const out: Record<string, FitTerm[]> = {};
    for (const t of terms) {
      if (t.type === 'CHASSIS' && t.parentId) {
        if (!out[t.parentId]) out[t.parentId] = [];
        out[t.parentId].push(t);
      }
    }
    return out;
  }, [terms]);

  // Per-product fitments & editor state
  const [fitmentsByProduct, setFitmentsByProduct] = useState<Record<string, ProductFitment[]>>({});
  const [editor, setEditor] = useState<Record<string, RowEditorState>>({});

  // Load products
  async function loadProducts(cursor?: string | null, append = false) {
    setLoading(true);
    setErr(null);
    try {
      const url = new URL('/api/admin/products', window.location.origin);
      url.searchParams.set('limit', '25');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Products HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json: ProductsResponse = await res.json();

      // Normalize shapes
      let items: ProductItem[] = [];
      let next: string | null = null;

      if ('items' in json && Array.isArray(json.items)) {
        items = json.items;
        next = (json.nextCursor as string | null) ?? null;
      } else {
        const edges = json.products?.edges ?? json.edges ?? [];
        items = edges.map(e => e.node);
        next = json.products?.pageInfo?.endCursor ?? json.pageInfo?.endCursor ?? null;
      }

      setProducts(prev => (append ? [...prev, ...items] : items));
      setNextCursor(next ?? null);

      // Initialize editor & fetch fitments for new products
      const newIds = items.map(p => p.id);
      const nextEditor = { ...(append ? editor : {}) };
      newIds.forEach(id => {
        if (!nextEditor[id]) {
          nextEditor[id] = {
            makeId: '',
            modelId: '',
            yearFrom: '',
            yearTo: '',
            trimId: '',
            chassisId: '',
          };
        }
      });
      setEditor(nextEditor);

      // Load fitments for the new batch
      await Promise.all(
        newIds.map(async (gid) => {
          const f = await fetchFitmentsFor(gid);
          setFitmentsByProduct(prev => ({ ...prev, [gid]: f }));
        })
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Load terms
  async function loadTerms() {
    try {
      const res = await fetch('/api/fit-terms', { cache: 'no-store' });
      const json = (await res.json()) as FitTermsResp | { rows?: FitTerm[] };
      const rows = 'rows' in json && Array.isArray(json.rows) ? json.rows : [];
      setTerms(rows);
    } catch {
      setErr('Failed to load fitment terms');
    }
  }

  // Initial load
  useEffect(() => {
    loadTerms();
    loadProducts(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch a product’s fitments
  async function fetchFitmentsFor(productGid: string): Promise<ProductFitment[]> {
    const url = new URL('/api/admin/fitments', window.location.origin);
    url.searchParams.set('productGid', productGid);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as FitmentsListResp | { fitments?: ProductFitment[] };
    return json.fitments ?? [];
  }

  // Editor field setters
  function setEditorField(productGid: string, key: keyof RowEditorState, value: string) {
    setEditor(prev => ({ ...prev, [productGid]: { ...prev[productGid], [key]: value } }));
  }

  function resetEditor(productGid: string) {
    setEditor(prev => ({
      ...prev,
      [productGid]: { makeId: '', modelId: '', yearFrom: '', yearTo: '', trimId: '', chassisId: '' },
    }));
  }

  // Derived dropdown options for a row
  function modelsFor(productGid: string): FitTerm[] {
    const makeId = editor[productGid]?.makeId;
    return makeId ? (modelsByParent[makeId] ?? []) : [];
  }
  function trimsFor(productGid: string): FitTerm[] {
    const modelId = editor[productGid]?.modelId;
    return modelId ? (trimsByParent[modelId] ?? []) : [];
  }
  function chassisFor(productGid: string): FitTerm[] {
    // Chassis are allowed under Make or Model in your term manager;
    // we’ll show those attached to either selection (prefer model first).
    const modelId = editor[productGid]?.modelId;
    const makeId = editor[productGid]?.makeId;
    if (modelId && chassisByParent[modelId]) return chassisByParent[modelId];
    if (makeId && chassisByParent[makeId]) return chassisByParent[makeId];
    return [];
  }

  // Actions
  async function addFitment(product: ProductItem) {
    setErr(null);
    const row = editor[product.id];
    if (!row?.makeId || !row?.modelId) {
      setErr('Make and Model are required');
      return;
    }
    const make = terms.find(t => t.id === row.makeId)?.name ?? '';
    const model = terms.find(t => t.id === row.modelId)?.name ?? '';
    if (!make || !model) {
      setErr('Invalid make/model selection');
      return;
    }

    const payload: UpsertPayload = {
      productGid: product.id,
      make,
      model,
      yearFrom: parseIntOrNull(row.yearFrom),
      yearTo: parseIntOrNull(row.yearTo),
      trim: row.trimId ? terms.find(t => t.id === row.trimId)?.name ?? null : null,
      chassis: row.chassisId ? terms.find(t => t.id === row.chassisId)?.name ?? null : null,
    };

    const res = await fetch('/api/admin/fitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setErr(j?.error || 'Add fitment failed');
      return;
    }

    // Refresh product’s fitments & reset row
    const fresh = await fetchFitmentsFor(product.id);
    setFitmentsByProduct(prev => ({ ...prev, [product.id]: fresh }));
    resetEditor(product.id);
  }

  async function deleteFitment(product: ProductItem, f: ProductFitment) {
    setErr(null);
    const payload: DeletePayload = {
      productGid: product.id,
      make: f.make,
      model: f.model,
      yearFrom: f.yearFrom ?? undefined,
      yearTo: f.yearTo ?? undefined,
      trim: f.trim ?? undefined,
      chassis: f.chassis ?? undefined,
    };

    const res = await fetch('/api/admin/fitments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setErr(j?.error || 'Delete fitment failed');
      return;
    }

    const fresh = await fetchFitmentsFor(product.id);
    setFitmentsByProduct(prev => ({ ...prev, [product.id]: fresh }));
  }

  /* =======================
     Render
     ======================= */

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Products ⇄ Fitments</h1>
      <p className="text-sm text-gray-800 mb-4">
        Assign Year / Make / Model (plus optional Trim & Chassis) to your products.  
        This writes the compiled fitment list to the product metafield (for storefront filtering).
      </p>

      {err && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 text-red-800 px-3 py-2">
          {err}
        </div>
      )}

      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full table-fixed">
          <thead className="bg-gray-50">
            <tr className="text-left text-gray-900 text-sm">
              <th className="p-3 w-[64px]">Image</th>
              <th className="p-3">Title</th>
              <th className="p-3 w-[160px]">Make</th>
              <th className="p-3 w-[160px]">Model</th>
              <th className="p-3 w-[120px]">Year From</th>
              <th className="p-3 w-[120px]">Year To</th>
              <th className="p-3 w-[160px]">Trim</th>
              <th className="p-3 w-[160px]">Chassis</th>
              <th className="p-3 w-[140px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-700">
                  No products found.
                </td>
              </tr>
            )}

            {products.map(p => {
              const row = editor[p.id] ?? {
                makeId: '',
                modelId: '',
                yearFrom: '',
                yearTo: '',
                trimId: '',
                chassisId: '',
              };
              const models = modelsFor(p.id);
              const trims = trimsFor(p.id);
              const chassis = chassisFor(p.id);
              const current = fitmentsByProduct[p.id] ?? [];

              return (
                <tr key={p.id} className="border-t align-top">
                  <td className="p-3">
                    {p.image ? (
                      // Keeping <img> per your preference to avoid Next/Image LCP tradeoffs now
                      <img
                        src={p.image}
                        alt={p.title}
                        className="w-12 h-12 object-cover rounded-md border"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gray-100 border rounded-md" />
                    )}
                  </td>

                  <td className="p-3">
                    <div className="text-gray-900 font-medium">{p.title}</div>
                    <div className="text-xs text-gray-700">{p.handle}</div>
                    {current.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {current.map(f => (
                          <span
                            key={`${f.make}-${f.model}-${f.yearFrom ?? ''}-${f.yearTo ?? ''}-${f.trim ?? ''}-${f.chassis ?? ''}`}
                            className="inline-flex items-center gap-2 rounded-full border bg-gray-50 px-2.5 py-1 text-xs text-gray-800"
                          >
                            {[
                              f.make,
                              f.model,
                              f.yearFrom ? `${f.yearFrom}` : null,
                              f.yearTo ? `${f.yearTo}` : null,
                              f.trim ? `Trim:${f.trim}` : null,
                              f.chassis ? `Chassis:${f.chassis}` : null,
                            ]
                              .filter(Boolean)
                              .join(' • ')}
                            <button
                              className="text-red-700 hover:underline ml-1"
                              onClick={() => deleteFitment(p, f)}
                              title="Remove fitment"
                            >
                              remove
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>

                  {/* Make */}
                  <td className="p-3">
                    <select
                      className="w-full border rounded-md p-2 text-gray-900"
                      value={row.makeId}
                      onChange={e => {
                        const makeId = e.target.value;
                        setEditorField(p.id, 'makeId', makeId);
                        // reset downstream selections
                        setEditorField(p.id, 'modelId', '');
                        setEditorField(p.id, 'trimId', '');
                        setEditorField(p.id, 'chassisId', '');
                      }}
                    >
                      <option value="">—</option>
                      {makes.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Model */}
                  <td className="p-3">
                    <select
                      className="w-full border rounded-md p-2 text-gray-900"
                      value={row.modelId}
                      onChange={e => {
                        const modelId = e.target.value;
                        setEditorField(p.id, 'modelId', modelId);
                        // reset downstream
                        setEditorField(p.id, 'trimId', '');
                        setEditorField(p.id, 'chassisId', '');
                      }}
                      disabled={!row.makeId}
                    >
                      <option value="">—</option>
                      {models.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Year From */}
                  <td className="p-3">
                    <input
                      className="w-full border rounded-md p-2 text-gray-900"
                      placeholder="e.g. 2015"
                      inputMode="numeric"
                      value={row.yearFrom}
                      onChange={e => setEditorField(p.id, 'yearFrom', e.target.value)}
                    />
                  </td>

                  {/* Year To */}
                  <td className="p-3">
                    <input
                      className="w-full border rounded-md p-2 text-gray-900"
                      placeholder="e.g. 2020"
                      inputMode="numeric"
                      value={row.yearTo}
                      onChange={e => setEditorField(p.id, 'yearTo', e.target.value)}
                    />
                  </td>

                  {/* Trim */}
                  <td className="p-3">
                    <select
                      className="w-full border rounded-md p-2 text-gray-900"
                      value={row.trimId}
                      onChange={e => setEditorField(p.id, 'trimId', e.target.value)}
                      disabled={!row.modelId}
                    >
                      <option value="">—</option>
                      {trims.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Chassis */}
                  <td className="p-3">
                    <select
                      className="w-full border rounded-md p-2 text-gray-900"
                      value={row.chassisId}
                      onChange={e => setEditorField(p.id, 'chassisId', e.target.value)}
                      disabled={!row.makeId && !row.modelId}
                    >
                      <option value="">—</option>
                      {chassis.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="p-3">
                    <button
                      className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-2 rounded disabled:opacity-50"
                      onClick={() => addFitment(p)}
                      disabled={!editor[p.id]?.makeId || !editor[p.id]?.modelId}
                      title="Add fitment"
                    >
                      Add
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="border-t p-3 flex items-center justify-between">
          <span className="text-sm text-gray-700">
            Showing {products.length} product{products.length === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="bg-gray-100 hover:bg-gray-200 text-gray-900 px-3 py-2 rounded"
              onClick={() => loadProducts(null, false)}
              disabled={loading}
              title="Reload first page"
            >
              Reload
            </button>
            <button
              className={cls(
                'px-3 py-2 rounded',
                nextCursor ? 'bg-blue-700 hover:bg-blue-800 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              )}
              onClick={() => nextCursor && loadProducts(nextCursor, true)}
              disabled={!nextCursor || loading}
              title="Load more"
            >
              Load more
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="mt-3 text-gray-800">
          Loading…
        </div>
      )}
    </main>
  );
}
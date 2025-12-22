'use client';

import { useEffect, useMemo, useState } from 'react';

type ProductItem = {
  id: string;           // gid://shopify/Product/...
  title: string;
  handle: string;
  image?: string | null;
  status?: string;
};

type ProductsResp = {
  items: ProductItem[];
  nextCursor?: string | null;
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

type FitmentsResp = {
  fitments?: Fitment[];   // our route
  items?: Fitment[];      // tolerate alternate shape
};

type SortOption = 'UPDATED_AT_DESC' | 'UPDATED_AT_ASC' | 'TITLE_ASC' | 'TITLE_DESC';

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export default function FitmentsAuditPage() {
  // Products list
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [prodErr, setProdErr] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('UPDATED_AT_DESC'); // NEW: sorting state

  // Fit terms (Make/Model tree)
  const [terms, setTerms] = useState<FitTerm[]>([]);
  const [loadingTerms, setLoadingTerms] = useState(false);
  const [termsErr, setTermsErr] = useState<string | null>(null);

  // Expanded state per product row
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Fitments per product
  const [fitmentsByProduct, setFitmentsByProduct] = useState<Record<string, Fitment[]>>({});
  const [loadingFitments, setLoadingFitments] = useState<Record<string, boolean>>({});
  const [fitErrs, setFitErrs] = useState<Record<string, string | null>>({});

  // Add-fitment form state per product
  type NewFitForm = {
    makeId: string;
    modelId: string;
    yearFrom: string;
    yearTo: string;
    trim: string;
    chassis: string;
  };
  const [newFitForm, setNewFitForm] = useState<Record<string, NewFitForm>>({});

  // Derived maps
  const makes = useMemo(() => terms.filter(t => t.type === 'MAKE'), [terms]);
  const modelsByParent: Record<string, FitTerm[]> = useMemo(() => {
    const out: Record<string, FitTerm[]> = {};
    for (const t of terms) {
      if (t.type === 'MODEL' && t.parentId) {
        if (!out[t.parentId]) out[t.parentId] = [];
        out[t.parentId].push(t);
      }
    }
    return out;
  }, [terms]);

  // ---------- Loaders ----------
  async function loadProducts(after?: string | null, append = false) {
    setLoadingProducts(true);
    setProdErr(null);
    try {
      const url = new URL('/api/admin/products', window.location.origin);
      url.searchParams.set('first', '20');
      url.searchParams.set('sortBy', sortBy); // NEW: pass sortBy parameter
      if (after) url.searchParams.set('after', after);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`Products HTTP ${res.status}`);
      const json = (await res.json()) as ProductsResp;
      setProducts(p => (append ? [...p, ...json.items] : json.items));
      setNextCursor(json.nextCursor ?? null);
    } catch (e) {
      setProdErr((e as Error).message);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadTerms() {
    setLoadingTerms(true);
    setTermsErr(null);
    try {
      const res = await fetch('/api/fit-terms', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fit-terms HTTP ${res.status}`);
      const json = (await res.json()) as FitTermsResp;
      setTerms(json.rows || []);
    } catch (e) {
      setTermsErr((e as Error).message);
    } finally {
      setLoadingTerms(false);
    }
  }

  async function loadFitments(productGid: string) {
    setLoadingFitments(s => ({ ...s, [productGid]: true }));
    setFitErrs(s => ({ ...s, [productGid]: null }));
    try {
      const url = new URL('/api/admin/fitments', window.location.origin);
      // IMPORTANT: use full GID (e.g. "gid://shopify/Product/..."), not numeric ID
      url.searchParams.set('productGid', productGid);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fitments HTTP ${res.status}`);
      const json = (await res.json()) as FitmentsResp;
      const items = json.fitments ?? json.items ?? [];
      setFitmentsByProduct(s => ({ ...s, [productGid]: items }));
    } catch (e) {
      setFitErrs(s => ({ ...s, [productGid]: (e as Error).message }));
    } finally {
      setLoadingFitments(s => ({ ...s, [productGid]: false }));
    }
  }

  useEffect(() => {
    loadProducts(null, false);
    loadTerms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NEW: Reload when sort changes
  useEffect(() => {
    setNextCursor(null);
    loadProducts(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  // ---------- Helpers ----------
  function ensureForm(productGid: string): NewFitForm {
    const cur = newFitForm[productGid];
    if (cur) return cur;
    const created: NewFitForm = {
      makeId: '',
      modelId: '',
      yearFrom: '',
      yearTo: '',
      trim: '',
      chassis: '',
    };
    setNewFitForm(s => ({ ...s, [productGid]: created }));
    return created;
  }

  function onToggle(product: ProductItem) {
    setOpen(s => {
      const now = !s[product.id];
      const next = { ...s, [product.id]: now };
      if (now && !fitmentsByProduct[product.id]) {
        // lazy load fitments for this product
        void loadFitments(product.id);
      }
      return next;
    });
  }

  function modelsForMake(makeId: string): FitTerm[] {
    if (!makeId) return [];
    return modelsByParent[makeId] || [];
  }

  function findTermName(id: string | null | undefined): string {
    if (!id) return '';
    const t = terms.find(x => x.id === id);
    return t?.name || '';
  }

  // ---------- Mutations ----------
  async function addFitment(product: ProductItem) {
    const form = ensureForm(product.id);
    // Validate
    if (!form.makeId) return alert('Pick a Make');
    if (!form.modelId) return alert('Pick a Model');
    const yearFrom = form.yearFrom ? Number(form.yearFrom) : null;
    const yearTo = form.yearTo ? Number(form.yearTo) : null;

    try {
      const res = await fetch('/api/admin/fitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productGid: product.id,
          make: findTermName(form.makeId),
          model: findTermName(form.modelId),
          yearFrom,
          yearTo,
          trim: form.trim || null,
          chassis: form.chassis || null,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Create fitment failed');
      }
      // Success → reload fitments
      await loadFitments(product.id);
      // Clear form
      setNewFitForm(s => ({ ...s, [product.id]: {
        makeId: '', modelId: '', yearFrom: '', yearTo: '', trim: '', chassis: '',
      }}));
    } catch (e) {
      alert((e as Error).message);
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
        const txt = await res.text();
        throw new Error(txt || 'Delete failed');
      }
      await loadFitments(productGid);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fitments Audit</h1>
          <p className="text-gray-700 text-sm">Manage product fitments by Make/Model/Year</p>
        </div>
        
        {/* NEW: SORTING DROPDOWN */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-700 font-medium">Sort by:</label>
          <select
            className="border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
          >
            <option value="UPDATED_AT_DESC">Last Edited (Newest First)</option>
            <option value="UPDATED_AT_ASC">Last Edited (Oldest First)</option>
            <option value="TITLE_ASC">Alphabetical (A-Z)</option>
            <option value="TITLE_DESC">Alphabetical (Z-A)</option>
          </select>
        </div>
      </div>

      {loadingTerms && <div className="text-gray-700">Loading fit terms…</div>}
      {termsErr && <div className="text-red-700">{termsErr}</div>}
      {prodErr && <div className="text-red-700">{prodErr}</div>}

      <div className="border rounded-lg overflow-auto bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-gray-900 font-semibold">Product</th>
              <th className="px-3 py-2 text-left text-gray-900 font-semibold hidden md:table-cell">Handle</th>
              <th className="px-3 py-2 text-left text-gray-900 font-semibold hidden md:table-cell">Status</th>
              <th className="px-3 py-2 text-left text-gray-900 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const isOpen = open[p.id] || false;
              const form = ensureForm(p.id);
              const fitLoad = Boolean(loadingFitments[p.id]);
              const fitErr = fitErrs[p.id] || null;
              const fitments = fitmentsByProduct[p.id] || [];

              return (
                <tr key={p.id} className="align-top">
                  <td className="px-3 py-3 border-b">
                    <div className="flex items-center gap-3">
                      {/* thumb */}
                      <div className="w-14 h-14 rounded overflow-hidden border bg-gray-100 shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.image || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif'}
                          alt={p.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{p.title}</div>
                        <div className="text-xs text-gray-600">{p.id}</div>
                      </div>
                    </div>

                    {/* expanded panel */}
                    {isOpen && (
                      <div className="mt-3 rounded-lg border bg-gray-50">
                        <div className="p-3">
                          <div className="font-semibold text-gray-900 mb-2">Fitments</div>

                          {fitErr && <div className="text-red-700 mb-2">{fitErr}</div>}
                          {fitLoad ? (
                            <div className="text-gray-700">Loading fitments…</div>
                          ) : fitments.length === 0 ? (
                            <div className="text-gray-700">None yet.</div>
                          ) : (
                            <ul className="space-y-1">
                              {fitments.map(f => (
                                <li
                                  key={f.id}
                                  className="flex items-center justify-between bg-white border rounded px-2 py-1"
                                >
                                  <div className="text-gray-900 text-sm">
                                    <span className="font-medium">{f.make}</span> {f.model ? `• ${f.model}` : ''}
                                    {f.yearFrom || f.yearTo ? (
                                      <span className="text-gray-700"> • {f.yearFrom ?? ''}–{f.yearTo ?? ''}</span>
                                    ) : null}
                                    {f.trim ? <span className="text-gray-700"> • {f.trim}</span> : null}
                                    {f.chassis ? <span className="text-gray-700"> • {f.chassis}</span> : null}
                                  </div>
                                  <button
                                    className="text-red-700 text-xs underline"
                                    onClick={() => deleteFitment(p.id, f.id)}
                                  >
                                    Remove
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* add form */}
                        <div className="p-3 border-t bg-white">
                          <div className="font-semibold text-gray-900 mb-2">Add fitment</div>
                          <div className="grid md:grid-cols-6 gap-2">
                            {/* Make */}
                            <select
                              className="border rounded p-2 text-gray-900"
                              value={form.makeId}
                              onChange={(e) => {
                                const makeId = e.target.value;
                                setNewFitForm(s => ({
                                  ...s,
                                  [p.id]: { ...s[p.id], makeId, modelId: '' },
                                }));
                              }}
                            >
                              <option value="">Make…</option>
                              {makes.map(mk => (
                                <option key={mk.id} value={mk.id}>{mk.name}</option>
                              ))}
                            </select>

                            {/* Model (filtered by make) */}
                            <select
                              className="border rounded p-2 text-gray-900"
                              value={form.modelId}
                              onChange={(e) => {
                                const modelId = e.target.value;
                                setNewFitForm(s => ({ ...s, [p.id]: { ...s[p.id], modelId } }));
                              }}
                              disabled={!form.makeId}
                            >
                              <option value="">Model…</option>
                              {modelsForMake(form.makeId).map(md => (
                                <option key={md.id} value={md.id}>{md.name}</option>
                              ))}
                            </select>

                            {/* Year From */}
                            <input
                              type="number"
                              placeholder="Year from"
                              className="border rounded p-2 text-gray-900"
                              value={form.yearFrom}
                              onChange={(e) =>
                                setNewFitForm(s => ({ ...s, [p.id]: { ...s[p.id], yearFrom: e.target.value } }))
                              }
                            />

                            {/* Year To */}
                            <input
                              type="number"
                              placeholder="Year to"
                              className="border rounded p-2 text-gray-900"
                              value={form.yearTo}
                              onChange={(e) =>
                                setNewFitForm(s => ({ ...s, [p.id]: { ...s[p.id], yearTo: e.target.value } }))
                              }
                            />

                            {/* Trim */}
                            <input
                              type="text"
                              placeholder="Trim (optional)"
                              className="border rounded p-2 text-gray-900"
                              value={form.trim}
                              onChange={(e) =>
                                setNewFitForm(s => ({ ...s, [p.id]: { ...s[p.id], trim: e.target.value } }))
                              }
                            />

                            {/* Chassis */}
                            <input
                              type="text"
                              placeholder="Chassis (optional)"
                              className="border rounded p-2 text-gray-900"
                              value={form.chassis}
                              onChange={(e) =>
                                setNewFitForm(s => ({ ...s, [p.id]: { ...s[p.id], chassis: e.target.value } }))
                              }
                            />
                          </div>

                          <div className="mt-2">
                            <button
                              className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded"
                              onClick={() => addFitment(p)}
                            >
                              Add fitment
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-3 border-b hidden md:table-cell text-gray-800">
                    /products/{p.handle}
                  </td>
                  <td className="px-3 py-3 border-b hidden md:table-cell text-gray-800">
                    {p.status || '—'}
                  </td>
                  <td className="px-3 py-3 border-b">
                    <button
                      className="text-blue-700 underline"
                      onClick={() => onToggle(p)}
                    >
                      {open[p.id] ? 'Hide' : 'Manage'}
                    </button>
                  </td>
                </tr>
              );
            })}

            {(!loadingProducts && products.length === 0) && (
              <tr>
                <td className="px-3 py-8 text-center text-gray-700" colSpan={4}>
                  No products found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <button
          className={classNames(
            'px-4 py-2 rounded border',
            nextCursor ? 'bg-white text-gray-900 hover:bg-gray-50' : 'bg-gray-100 text-gray-500 cursor-not-allowed'
          )}
          disabled={!nextCursor || loadingProducts}
          onClick={() => loadProducts(nextCursor, true)}
        >
          {loadingProducts ? 'Loading…' : 'Load more'}
        </button>
      </div>
    </main>
  );
}
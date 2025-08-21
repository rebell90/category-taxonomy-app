'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

type Product = {
  id: string;            // admin GID: gid://shopify/Product/123...
  title: string;
  handle: string;
  featuredImage?: { url?: string | null } | null;
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

type FitmentDraft = {
  make: string;
  model: string;
  yearFrom: string; // keep as string for inputs, convert on save
  yearTo: string;
  trim: string;
  chassis: string;
};

const PRODUCTS_API = '/api/admin/products';      // change if yours differs
const FITMENTS_API_PUBLIC = '/api/fitments';
const FITMENTS_API_ADMIN = '/api/admin/fitments';

// light, readable theme
const cardCls =
  'rounded-xl border border-gray-300/70 bg-white shadow-sm hover:shadow-md transition p-4';
const btnCls =
  'inline-flex items-center rounded-md px-3 py-1.5 text-sm font-semibold';
const btnPrimary =
  `${btnCls} bg-blue-600 text-white hover:bg-blue-700`;
const btnGhost =
  `${btnCls} bg-transparent text-gray-700 hover:bg-gray-100 border border-gray-300`;
const inputCls =
  'border border-gray-300 rounded-md px-3 py-2 text-sm w-full text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
const labelCls = 'text-sm font-semibold text-gray-800';
const h1Cls = 'text-2xl font-bold text-gray-900';
const h2Cls = 'text-lg font-semibold text-gray-900';

export default function ProductFitmentsPage() {
  const [search, setSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [fitmentsByProduct, setFitmentsByProduct] = useState<
    Record<string, Fitment[]>
  >({});
  const [draftByProduct, setDraftByProduct] = useState<
    Record<string, FitmentDraft>
  >({});

  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => {
    void loadProducts(debouncedSearch);
  }, [debouncedSearch]);

  async function loadProducts(q: string) {
    setLoadingProducts(true);
    try {
      const url = new URL(PRODUCTS_API, location.origin);
      if (q.trim()) url.searchParams.set('search', q.trim());
      // you can add &limit=50 if you want
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`Products HTTP ${res.status}`);
      const json = await res.json();
      // expect { products: { edges: [{ node: {id,title,handle,featuredImage{url}}}] } } OR a flat array
      const edges: Array<{ node: Product }> =
        json?.products?.edges ??
        (Array.isArray(json?.products)
          ? json.products.map((p: Product) => ({ node: p }))
          : []);
      const list = edges.map(e => e.node);
      setProducts(list);
    } catch (e) {
      console.error('loadProducts error', e);
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function toggleExpand(product: Product) {
    const pid = product.id;
    setExpanded(prev => ({ ...prev, [pid]: !prev[pid] }));
    // lazy-load fitments on first expand
    if (!fitmentsByProduct[pid]) {
      await loadFitments(pid);
      // seed a draft
      setDraftByProduct(prev => ({
        ...prev,
        [pid]: {
          make: '',
          model: '',
          yearFrom: '',
          yearTo: '',
          trim: '',
          chassis: '',
        },
      }));
    }
  }

  async function loadFitments(productGid: string) {
    try {
      const url = new URL(FITMENTS_API_PUBLIC, location.origin);
      url.searchParams.set('productGid', productGid);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fitments HTTP ${res.status}`);
      const json: Fitment[] = await res.json();
      setFitmentsByProduct(prev => ({ ...prev, [productGid]: json }));
    } catch (e) {
      console.error('loadFitments error', e);
      setFitmentsByProduct(prev => ({ ...prev, [productGid]: [] }));
    }
  }

  function setDraft(productGid: string, patch: Partial<FitmentDraft>) {
    setDraftByProduct(prev => ({
      ...prev,
      [productGid]: { ...(prev[productGid] ?? defaultDraft()), ...patch },
    }));
  }

  async function addFitment(productGid: string) {
    const draft = draftByProduct[productGid] ?? defaultDraft();
    const body = {
      productGid,
      make: draft.make.trim(),
      model: draft.model.trim(),
      yearFrom: parseIntOrNull(draft.yearFrom),
      yearTo: parseIntOrNull(draft.yearTo),
      trim: emptyToNull(draft.trim),
      chassis: emptyToNull(draft.chassis),
    };

    if (!body.make || !body.model) {
      alert('Make and Model are required.');
      return;
    }

    try {
      const res = await fetch(FITMENTS_API_ADMIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      // refresh list
      await loadFitments(productGid);
      // reset draft
      setDraftByProduct(prev => ({ ...prev, [productGid]: defaultDraft() }));
    } catch (e) {
      console.error('addFitment error', e);
      alert('Failed to add fitment. See console for details.');
    }
  }

  async function removeFitment(productGid: string, fitmentId: string) {
    if (!confirm('Remove this fitment?')) return;
    try {
      const res = await fetch(FITMENTS_API_ADMIN, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fitmentId }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      // refresh
      await loadFitments(productGid);
    } catch (e) {
      console.error('removeFitment error', e);
      alert('Failed to remove fitment. See console for details.');
    }
  }

  const header = useMemo(
    () => (
      <div className="mb-6">
        <h1 className={h1Cls}>Assign Fitments (Y/M/M) by Product</h1>
        <p className="text-gray-700 mt-1">
          Search your products, expand a row, and add/remove Year/Make/Model fitments inline.
        </p>
        <div className="mt-4">
          <input
            className={inputCls}
            placeholder="Search products by title or handle…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
    ),
    [search]
  );

  return (
    <main className="p-6 space-y-4 bg-gray-50 min-h-screen">
      {header}

      {loadingProducts && (
        <div className={cardCls}>
          <p className="text-gray-800">Loading products…</p>
        </div>
      )}

      {!loadingProducts && products.length === 0 && (
        <div className={cardCls}>
          <p className="text-gray-800">No products found.</p>
        </div>
      )}

      <div className="grid gap-4">
        {products.map((p) => {
          const isOpen = !!expanded[p.id];
          const fitments = fitmentsByProduct[p.id] ?? [];
          const draft = draftByProduct[p.id] ?? defaultDraft();
          const img = p.featuredImage?.url || '';

          return (
            <div key={p.id} className={cardCls}>
              <div className="flex items-center gap-4">
                <div className="relative w-14 h-14 rounded-md overflow-hidden border border-gray-300 bg-gray-100 flex-shrink-0">
                  {img ? (
                    <Image src={img} alt={p.title} fill sizes="56px" style={{ objectFit: 'cover' }} />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-xs text-gray-500">
                      No image
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <div className="text-gray-900 font-semibold">{p.title}</div>
                  <div className="text-gray-700 text-sm">@{p.handle}</div>
                </div>

                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => void toggleExpand(p)}
                >
                  {isOpen ? 'Hide Fitments' : 'Manage Fitments'}
                </button>
              </div>

              {isOpen && (
                <div className="mt-4 border-t border-gray-200 pt-4 space-y-4">
                  <div>
                    <h2 className={h2Cls}>Current Fitments</h2>
                    {fitments.length === 0 ? (
                      <p className="text-gray-800 mt-2">No fitments yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead>
                            <tr className="text-gray-800">
                              <th className="py-2 pr-3">Years</th>
                              <th className="py-2 pr-3">Make</th>
                              <th className="py-2 pr-3">Model</th>
                              <th className="py-2 pr-3">Trim</th>
                              <th className="py-2 pr-3">Chassis</th>
                              <th className="py-2 pr-3"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {fitments.map(f => (
                              <tr key={f.id} className="border-t border-gray-200 text-gray-900">
                                <td className="py-2 pr-3">
                                  {f.yearFrom ?? '—'}&nbsp;–&nbsp;{f.yearTo ?? '—'}
                                </td>
                                <td className="py-2 pr-3">{f.make}</td>
                                <td className="py-2 pr-3">{f.model}</td>
                                <td className="py-2 pr-3">{f.trim ?? '—'}</td>
                                <td className="py-2 pr-3">{f.chassis ?? '—'}</td>
                                <td className="py-2 pr-3">
                                  <button
                                    type="button"
                                    className={`${btnGhost} text-red-600 border-red-300 hover:bg-red-50`}
                                    onClick={() => void removeFitment(p.id, f.id)}
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <h2 className={h2Cls}>Add Fitment</h2>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-2">
                      <div>
                        <label className={labelCls}>Make</label>
                        <input
                          className={inputCls}
                          value={draft.make}
                          onChange={e => setDraft(p.id, { make: e.target.value })}
                          placeholder="e.g. Toyota"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Model</label>
                        <input
                          className={inputCls}
                          value={draft.model}
                          onChange={e => setDraft(p.id, { model: e.target.value })}
                          placeholder="e.g. Camry"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Year From</label>
                        <input
                          className={inputCls}
                          inputMode="numeric"
                          value={draft.yearFrom}
                          onChange={e => setDraft(p.id, { yearFrom: e.target.value })}
                          placeholder="e.g. 2018"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Year To</label>
                        <input
                          className={inputCls}
                          inputMode="numeric"
                          value={draft.yearTo}
                          onChange={e => setDraft(p.id, { yearTo: e.target.value })}
                          placeholder="e.g. 2020"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Trim (optional)</label>
                        <input
                          className={inputCls}
                          value={draft.trim}
                          onChange={e => setDraft(p.id, { trim: e.target.value })}
                          placeholder="e.g. SE"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Chassis (optional)</label>
                        <input
                          className={inputCls}
                          value={draft.chassis}
                          onChange={e => setDraft(p.id, { chassis: e.target.value })}
                          placeholder="e.g. E90"
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        className={btnPrimary}
                        onClick={() => void addFitment(p.id)}
                      >
                        Add Fitment
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}

/** utils */
function defaultDraft(): FitmentDraft {
  return { make: '', model: '', yearFrom: '', yearTo: '', trim: '', chassis: '' };
}
function parseIntOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function emptyToNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}
function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
'use client';

import { useEffect, useMemo, useState } from 'react';

type ProductNode = {
  id: string;              // gid://shopify/Product/...
  title: string;
  handle: string;
  featuredImage?: { url: string; altText?: string } | null;
};

type ProductsResponse = {
  products: {
    edges: Array<{ node: ProductNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

// Fit term tree (from /api/fit-terms)
type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';
type FitTerm = { id: string; type: FitTermType; name: string; parentId: string | null; children?: FitTerm[] };
type FitTermsResponse = { rows: FitTerm[]; tree: FitTerm[] };

// Fitments list for a product (from /api/admin/fitments?productGid=...)
type ProductFitment = {
  id: string;
  productGid: string;
  make: string;
  model: string;
  trim: string | null;
  chassis: string | null;
  yearFrom: number | null;
  yearTo: number | null;
};

type FitmentsListResponse = { items: ProductFitment[] };

// Helpers
function getGidShort(gid: string): string {
  // gid://shopify/Product/123 -> 123
  const parts = gid.split('/');
  return parts[parts.length - 1] || gid;
}

function emptyToNull(s?: string | null): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t.length ? t : null;
}

export default function FitmentsAuditPage() {
  // products
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [prodErr, setProdErr] = useState<string | null>(null);

  // fit terms (for selectors)
  const [termsFlat, setTermsFlat] = useState<FitTerm[]>([]);
  const [loadingTerms, setLoadingTerms] = useState(false);
  const [termsErr, setTermsErr] = useState<string | null>(null);

  // current fitments per product id
  const [fitments, setFitments] = useState<Record<string, ProductFitment[]>>({});
  const [fitErr, setFitErr] = useState<string | null>(null);
  const [busyProduct, setBusyProduct] = useState<string | null>(null); // show spinner on a row

  // add-fitment form state per product (keyed by productGid)
  type NewFitmentForm = {
    makeId: string;
    modelId: string;
    trimId: string;
    chassisId: string;
    yearFrom: string;
    yearTo: string;
  };
  const [forms, setForms] = useState<Record<string, NewFitmentForm>>({});

  // derived term buckets
  const makes = useMemo(() => termsFlat.filter(t => t.type === 'MAKE'), [termsFlat]);
  const models = useMemo(() => termsFlat.filter(t => t.type === 'MODEL'), [termsFlat]);
  const trims  = useMemo(() => termsFlat.filter(t => t.type === 'TRIM'),  [termsFlat]);
  const chassis= useMemo(() => termsFlat.filter(t => t.type === 'CHASSIS'), [termsFlat]);

  // filtered options given a selected parent
  const modelsForMake = (makeId: string) =>
    models.filter(m => m.parentId === makeId);
  const trimsForModel = (modelId: string) =>
    trims.filter(t => t.parentId === modelId);
  const chassisFor = (makeId: string, modelId: string) =>
    chassis.filter(c => c.parentId === makeId || c.parentId === modelId);

  // --- Loaders ---
  async function loadTerms() {
    setLoadingTerms(true);
    setTermsErr(null);
    try {
      const res = await fetch('/api/fit-terms', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Terms HTTP ${res.status}`);
      const json = (await res.json()) as FitTermsResponse;
      setTermsFlat(json.rows || []);
    } catch (e) {
      setTermsErr((e as Error).message);
    } finally {
      setLoadingTerms(false);
    }
  }

  async function loadProducts({ append }: { append: boolean }) {
    setLoadingProducts(true);
    setProdErr(null);
    try {
      const url = new URL('/api/admin/products', location.origin);
      url.searchParams.set('first', '20');
      if (append && cursor) url.searchParams.set('after', cursor);

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`Products HTTP ${res.status}`);
      const json = (await res.json()) as ProductsResponse;

      const edges = json.products?.edges ?? [];
      const pageInfo = json.products?.pageInfo ?? { hasNextPage: false, endCursor: null };

      const nodes = edges.map(e => e.node);
      setProducts(prev => (append ? [...prev, ...nodes] : nodes));
      setHasNext(Boolean(pageInfo.hasNextPage));
      setCursor(pageInfo.endCursor ?? null);
    } catch (e) {
      setProdErr((e as Error).message);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadProductFitments(productGid: string) {
    try {
      const res = await fetch(`/api/admin/fitments?productGid=${encodeURIComponent(productGid)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fitments HTTP ${res.status}`);
      const json = (await res.json()) as FitmentsListResponse;
      setFitments(prev => ({ ...prev, [productGid]: json.items || [] }));
    } catch (e) {
      setFitErr((e as Error).message);
    }
  }

  // Initial loads
  useEffect(() => {
    void loadTerms();
    void loadProducts({ append: false });
  }, []);

  // whenever products list changes, fetch their fitments
  useEffect(() => {
    products.forEach(p => { if (!fitments[p.id]) void loadProductFitments(p.id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // --- Actions ---
  function initFormIfNeeded(productGid: string) {
    setForms(prev => prev[productGid]
      ? prev
      : ({ ...prev, [productGid]: { makeId: '', modelId: '', trimId: '', chassisId: '', yearFrom: '', yearTo: '' } })
    );
  }

  function setForm(productGid: string, patch: Partial<NewFitmentForm>) {
    setForms(prev => ({ ...prev, [productGid]: { ...(prev[productGid] ?? {
      makeId: '', modelId: '', trimId: '', chassisId: '', yearFrom: '', yearTo: ''
    }), ...patch } }));
  }

  async function addFitment(product: ProductNode) {
    const f = forms[product.id];
    if (!f || !f.makeId || !f.modelId) {
      alert('Select at least Make and Model');
      return;
    }
    const make = makes.find(m => m.id === f.makeId)?.name ?? '';
    const model = models.find(m => m.id === f.modelId)?.name ?? '';
    const trim  = emptyToNull(trims.find(t => t.id === f.trimId)?.name ?? null);
    const chas  = emptyToNull(chassis.find(c => c.id === f.chassisId)?.name ?? null);

    const yearFrom = f.yearFrom.trim() ? Number(f.yearFrom) : null;
    const yearTo   = f.yearTo.trim()   ? Number(f.yearTo)   : null;

    if (yearFrom !== null && Number.isNaN(yearFrom)) return alert('Year From must be a number');
    if (yearTo !== null && Number.isNaN(yearTo))     return alert('Year To must be a number');

    try {
      setBusyProduct(product.id);
      const res = await fetch('/api/admin/fitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productGid: product.id,
          make,
          model,
          trim,
          chassis: chas,
          yearFrom,
          yearTo,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Add failed (${res.status})`);
      }
      await loadProductFitments(product.id);
      // keep form selections (nice when adding multiple variants), but clear years
      setForm(product.id, { yearFrom: '', yearTo: '' });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyProduct(null);
    }
  }

  async function removeFitment(product: ProductNode, fit: ProductFitment) {
    if (!confirm(`Remove ${fit.make} ${fit.model}${fit.trim ? ' ' + fit.trim : ''}${fit.chassis ? ' (' + fit.chassis + ')' : ''}${fit.yearFrom ? ' ' + fit.yearFrom : ''}${fit.yearTo ? '–' + fit.yearTo : ''}?`)) {
      return;
    }
    try {
      setBusyProduct(product.id);
      const res = await fetch('/api/admin/fitments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fit.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Delete failed (${res.status})`);
      }
      await loadProductFitments(product.id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyProduct(null);
    }
  }

  // --- UI ---
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Products ↔ Fitments</h1>
      <p className="text-sm text-gray-700 mb-4">
        Add Make / Model (and optional Trim, Chassis, Years) to products. Terms come from <code>/dashboard/fit-terms</code>.
      </p>

      {termsErr && <div className="text-red-700 mb-3">Fit terms error: {termsErr}</div>}
      {prodErr &&  <div className="text-red-700 mb-3">Products error: {prodErr}</div>}
      {fitErr &&   <div className="text-red-700 mb-3">Fitments error: {fitErr}</div>}

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[96px_1fr_420px] gap-0 border-b px-3 py-2 bg-gray-50 text-gray-800 font-semibold">
          <div>Image</div>
          <div>Product</div>
          <div>Fitments (existing) + Add</div>
        </div>

        {products.length === 0 && !loadingProducts && (
          <div className="p-6 text-gray-800">No products found.</div>
        )}

        {products.map(prod => {
          const f = forms[prod.id] ?? { makeId: '', modelId: '', trimId: '', chassisId: '', yearFrom: '', yearTo: '' };
          const modelOpts = f.makeId ? modelsForMake(f.makeId) : [];
          const trimOpts  = f.modelId ? trimsForModel(f.modelId) : [];
          const chasOpts  = chassisFor(f.makeId, f.modelId);

          const current = fitments[prod.id] || [];

          return (
            <div key={prod.id} className="grid grid-cols-[96px_1fr_420px] gap-0 border-b px-3 py-3 items-start">
              <div className="pr-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={prod.featuredImage?.url || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif'}
                  alt={prod.featuredImage?.altText || prod.title}
                  className="w-[80px] h-[80px] object-cover rounded border"
                />
              </div>

              <div className="pr-4">
                <div className="font-semibold text-gray-900">{prod.title}</div>
                <div className="text-xs text-gray-700">#{getGidShort(prod.id)} · /products/{prod.handle}</div>
              </div>

              <div className="space-y-2">
                {/* Current fitments */}
                <div className="space-y-1">
                  {current.length === 0 ? (
                    <div className="text-sm text-gray-700">No fitments.</div>
                  ) : (
                    current.map(cf => (
                      <div key={cf.id} className="text-sm text-gray-900 flex items-center gap-2">
                        <span>
                          {cf.make} {cf.model}
                          {cf.trim ? ` ${cf.trim}` : ''}
                          {cf.chassis ? ` (${cf.chassis})` : ''}
                          {cf.yearFrom ? ` ${cf.yearFrom}` : ''}
                          {cf.yearTo ? `–${cf.yearTo}` : ''}
                        </span>
                        <button
                          type="button"
                          className="text-red-700 text-xs underline"
                          onClick={() => removeFitment(prod, cf)}
                          disabled={busyProduct === prod.id}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add form */}
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="border rounded p-2 text-gray-900"
                    value={f.makeId}
                    onChange={e => {
                      initFormIfNeeded(prod.id);
                      const makeId = e.target.value;
                      // reset downstream fields
                      setForm(prod.id, { makeId, modelId: '', trimId: '', chassisId: '' });
                    }}
                  >
                    <option value="">Make…</option>
                    {makes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>

                  <select
                    className="border rounded p-2 text-gray-900"
                    value={f.modelId}
                    onChange={e => {
                      initFormIfNeeded(prod.id);
                      const modelId = e.target.value;
                      setForm(prod.id, { modelId, trimId: '', chassisId: '' });
                    }}
                    disabled={!f.makeId}
                  >
                    <option value="">Model…</option>
                    {modelOpts.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>

                  <select
                    className="border rounded p-2 text-gray-900"
                    value={f.trimId}
                    onChange={e => setForm(prod.id, { trimId: e.target.value })}
                    disabled={!f.modelId}
                  >
                    <option value="">Trim (optional)</option>
                    {trimOpts.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>

                  <select
                    className="border rounded p-2 text-gray-900"
                    value={f.chassisId}
                    onChange={e => setForm(prod.id, { chassisId: e.target.value })}
                    disabled={!f.makeId && !f.modelId}
                  >
                    <option value="">Chassis (optional)</option>
                    {chasOpts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>

                  <input
                    className="border rounded p-2 text-gray-900"
                    placeholder="Year From"
                    inputMode="numeric"
                    value={f.yearFrom}
                    onChange={e => setForm(prod.id, { yearFrom: e.target.value })}
                  />
                  <input
                    className="border rounded p-2 text-gray-900"
                    placeholder="Year To"
                    inputMode="numeric"
                    value={f.yearTo}
                    onChange={e => setForm(prod.id, { yearTo: e.target.value })}
                  />
                </div>

                <div>
                  <button
                    type="button"
                    className="bg-blue-700 hover:bg-blue-800 text-white text-sm px-3 py-2 rounded"
                    onClick={() => addFitment(prod)}
                    disabled={busyProduct === prod.id || loadingTerms}
                  >
                    {busyProduct === prod.id ? 'Saving…' : 'Add Fitment'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        <div className="p-3">
          <button
            type="button"
            className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded"
            disabled={!hasNext || loadingProducts}
            onClick={() => loadProducts({ append: true })}
          >
            {loadingProducts ? 'Loading…' : (hasNext ? 'Load more products' : 'No more products')}
          </button>
        </div>
      </div>
    </main>
  );
}
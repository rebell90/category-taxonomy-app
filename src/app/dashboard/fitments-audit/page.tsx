'use client';

import { useEffect, useMemo, useState } from 'react';

// ---------- Types ----------
type ImageLite = { url: string; altText: string | null } | null;

type ProductNode = {
  id: string;          // gid://shopify/Product/...
  handle: string;
  title: string;
  featuredImage: ImageLite;
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
  yearFrom: number | null;
  yearTo: number | null;
  make: string;
  model: string;
  trim: string | null;
  chassis: string | null;
  createdAt: string;
  updatedAt: string;
};

type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';
type FitTerm = {
  id: string;
  type: FitTermType;
  name: string;
  parentId: string | null;
  children?: FitTerm[];
};
type FitTermsTreeResponse = { rows: FitTerm[]; tree: FitTerm[] };

// ---------- Helpers ----------
function classNames(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(' ');
}
function safeNumOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Build dependent selections for Fit Terms
function indexFitTerms(rows: FitTerm[]) {
  const makes = rows.filter(r => r.type === 'MAKE');

  // Map: makeId -> models[]
  const modelsByMake: Record<string, FitTerm[]> = {};
  // Map: modelId -> trims[]
  const trimsByModel: Record<string, FitTerm[]> = {};
  // Chassis can belong to MAKE or MODEL; we’ll offer both:
  const chassisByMake: Record<string, FitTerm[]> = {};
  const chassisByModel: Record<string, FitTerm[]> = {};

  // Build quick lookup by id and parent relations
  const byId: Record<string, FitTerm> = {};
  rows.forEach(r => { byId[r.id] = r; });

  // Pre-fill maps
  rows.forEach(r => {
    if (r.type === 'MODEL' && r.parentId) {
      (modelsByMake[r.parentId] ||= []).push(r);
    } else if (r.type === 'TRIM' && r.parentId) {
      (trimsByModel[r.parentId] ||= []).push(r);
    } else if (r.type === 'CHASSIS' && r.parentId) {
      const parent = byId[r.parentId];
      if (parent?.type === 'MAKE') (chassisByMake[parent.id] ||= []).push(r);
      if (parent?.type === 'MODEL') (chassisByModel[parent.id] ||= []).push(r);
    }
  });

  // Also expose simple lists by type (for fallback/manual):
  const models = rows.filter(r => r.type === 'MODEL');
  const trims = rows.filter(r => r.type === 'TRIM');
  const chassis = rows.filter(r => r.type === 'CHASSIS');

  return { makes, modelsByMake, trimsByModel, chassisByMake, chassisByModel, models, trims, chassis };
}

// ---------- Component ----------
export default function FitmentsAuditPage() {
  // Products state
  const [products, setProducts] = useState<ProductNode[]>([]);
  const [q, setQ] = useState('');
  const [hasNext, setHasNext] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fit terms (for dropdowns)
  const [fitRows, setFitRows] = useState<FitTerm[]>([]);
  const termsIndex = useMemo(() => indexFitTerms(fitRows), [fitRows]);

  // Per-product: currently loaded fitments
  const [fitmentsByProduct, setFitmentsByProduct] = useState<Record<string, Fitment[]>>({});
  // Per-product: show add form?
  const [openAddFor, setOpenAddFor] = useState<Record<string, boolean>>({});
  // Per-product: add form fields
  type AddForm = {
    yearFrom: string;
    yearTo: string;
    makeId: string;
    modelId: string;
    trimId: string;
    chassisId: string;
    // resolved names we’ll send
    makeName: string;
    modelName: string;
    trimName: string;
    chassisName: string;
  };
  const [addForms, setAddForms] = useState<Record<string, AddForm>>({});

  // -------- Loaders --------
  async function loadFitTerms() {
    try {
      const res = await fetch('/api/fit-terms', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fit terms HTTP ${res.status}`);
      const json = (await res.json()) as FitTermsTreeResponse;
      setFitRows(json.rows || []);
    } catch (e) {
      // Non-fatal for page load; just show manual input if needed
      console.error('Failed to load fit terms', e);
    }
  }

  async function loadProducts(append = false) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams();
      qs.set('first', '50');
      if (append && nextCursor) qs.set('after', nextCursor);
      if (q.trim()) qs.set('q', q.trim());

      const res = await fetch(`/api/admin/products-audit?${qs.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Products HTTP ${res.status}`);

      const json = (await res.json()) as ProductsResponse;
      const edges = json.products?.edges ?? [];
      const pageInfo = json.products?.pageInfo ?? { hasNextPage: false, endCursor: null };

      const nodes = edges.map(e => e.node);
      setProducts(prev => (append ? [...prev, ...nodes] : nodes));
      setHasNext(Boolean(pageInfo.hasNextPage));
      setNextCursor(pageInfo.endCursor ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }

  async function loadFitmentsForProduct(productGid: string) {
    try {
      const qs = new URLSearchParams();
      qs.set('productGid', productGid);
      const res = await fetch(`/api/admin/fitments?${qs.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fitments HTTP ${res.status}`);
      const json = (await res.json()) as { items: Fitment[] };
      setFitmentsByProduct(prev => ({ ...prev, [productGid]: json.items || [] }));
    } catch (e) {
      console.error('Load fitments failed', e);
      setFitmentsByProduct(prev => ({ ...prev, [productGid]: [] }));
    }
  }

  // -------- Actions --------
  function toggleAddForm(productGid: string) {
    setOpenAddFor(prev => ({ ...prev, [productGid]: !prev[productGid] }));
    // Initialize form if empty
    setAddForms(prev => ({
      ...prev,
      [productGid]: prev[productGid] || {
        yearFrom: '',
        yearTo: '',
        makeId: '',
        modelId: '',
        trimId: '',
        chassisId: '',
        makeName: '',
        modelName: '',
        trimName: '',
        chassisName: '',
      },
    }));
  }

  function onChangeForm(productGid: string, patch: Partial<AddForm>) {
    setAddForms(prev => {
      const curr = prev[productGid] || {
        yearFrom: '',
        yearTo: '',
        makeId: '',
        modelId: '',
        trimId: '',
        chassisId: '',
        makeName: '',
        modelName: '',
        trimName: '',
        chassisName: '',
      };
      const next = { ...curr, ...patch };

      // If make changed, clear dependent fields
      if (patch.makeId !== undefined) {
        next.modelId = '';
        next.trimId = '';
        next.chassisId = '';
        next.makeName = fitRows.find(f => f.id === patch.makeId)?.name || '';
        next.modelName = '';
        next.trimName = '';
        next.chassisName = '';
      }
      // If model changed, clear its dependents
      if (patch.modelId !== undefined) {
        next.trimId = '';
        next.chassisId = '';
        next.modelName = fitRows.find(f => f.id === patch.modelId)?.name || '';
        next.trimName = '';
        next.chassisName = '';
      }
      if (patch.trimId !== undefined) {
        next.trimName = fitRows.find(f => f.id === patch.trimId)?.name || '';
      }
      if (patch.chassisId !== undefined) {
        next.chassisName = fitRows.find(f => f.id === patch.chassisId)?.name || '';
      }

      return { ...prev, [productGid]: next };
    });
  }

  async function addFitment(product: ProductNode) {
    const form = addForms[product.id];
    if (!form) return;

    const payload = {
      productGid: product.id,
      yearFrom: safeNumOrNull(form.yearFrom),
      yearTo: safeNumOrNull(form.yearTo),
      make: form.makeName || '',
      model: form.modelName || '',
      trim: form.trimName || null,
      chassis: form.chassisName || null,
    };

    // Basic validation
    if (!payload.make || !payload.model) {
      alert('Please select at least Make and Model.');
      return;
    }
    if (payload.yearFrom && payload.yearTo && payload.yearFrom > payload.yearTo) {
      alert('Year From must be <= Year To.');
      return;
    }

    try {
      const res = await fetch('/api/admin/fitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Assign failed (${res.status})`);
      }
      // Refresh list
      await loadFitmentsForProduct(product.id);
      // Collapse form
      setOpenAddFor(prev => ({ ...prev, [product.id]: false }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Assign failed: ${msg}`);
    }
  }

  async function removeFitment(fit: Fitment) {
    if (!confirm('Remove this fitment?')) return;
    try {
      const res = await fetch('/api/admin/fitments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fit.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Remove failed (${res.status})`);
      }
      // Refresh product’s fitments
      await loadFitmentsForProduct(fit.productGid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Remove failed: ${msg}`);
    }
  }

  // -------- Effects --------
  useEffect(() => {
    loadFitTerms();
    // initial products
    // eslint-disable-next-line react-hooks/exhaustive-deps
    loadProducts(false);
  }, []);

  // When you expand a product’s fitments panel, fetch its fitments
  function toggleOpenAndLoad(product: ProductNode) {
    const alreadyLoaded = !!fitmentsByProduct[product.id];
    const currentlyOpen = openAddFor[product.id] || false;
    // Only load when opening the panel if not already loaded
    if (!currentlyOpen && !alreadyLoaded) loadFitmentsForProduct(product.id);
    toggleAddForm(product.id);
  }

  // -------- Render --------
  const { makes, modelsByMake, trimsByModel, chassisByMake, chassisByModel } = termsIndex;

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Products ⇄ Fitments</h1>
      <p className="text-sm text-gray-700 mb-4">
        Assign Year/Make/Model/Trim/Chassis fitments to each product. Make &amp; Model are required. Years are optional (range).
      </p>

      <div className="mb-4 flex gap-2">
        <input
          className="border rounded-md p-2 w-full max-w-md text-gray-900"
          placeholder="Filter products by title…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button
          className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded"
          onClick={() => loadProducts(false)}
          disabled={loading}
        >
          Search
        </button>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 border border-red-200 bg-red-50 text-red-800 rounded">
          {errorMsg}
        </div>
      )}

      <div className="border rounded-xl overflow-hidden bg-white">
        <div className="grid grid-cols-[96px_1fr_280px] gap-0 border-b bg-gray-50 text-gray-800 font-semibold text-sm">
          <div className="px-3 py-2 border-r">Image</div>
          <div className="px-3 py-2 border-r">Title</div>
          <div className="px-3 py-2">Fitments</div>
        </div>

        {products.length === 0 && !loading && (
          <div className="p-4 text-gray-700">No products found.</div>
        )}

        {products.map((p) => {
          const open = openAddFor[p.id] || false;
          const fList = fitmentsByProduct[p.id] || [];

          const form = addForms[p.id] || {
            yearFrom: '',
            yearTo: '',
            makeId: '',
            modelId: '',
            trimId: '',
            chassisId: '',
            makeName: '',
            modelName: '',
            trimName: '',
            chassisName: '',
          };

          const models = form.makeId ? (modelsByMake[form.makeId] || []) : [];
          const trims  = form.modelId ? (trimsByModel[form.modelId] || []) : [];
          const chassisOptions = [
            ...(form.makeId ? (chassisByMake[form.makeId] || []) : []),
            ...(form.modelId ? (chassisByModel[form.modelId] || []) : []),
          ];

          return (
            <div key={p.id} className="grid grid-cols-[96px_1fr_280px] gap-0 border-t">
              <div className="p-2 border-r flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.featuredImage?.url || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif'}
                  alt={p.featuredImage?.altText || p.title}
                  className="w-[64px] h-[64px] object-cover rounded border"
                />
              </div>
              <div className="p-3 border-r">
                <div className="font-medium text-gray-900">{p.title}</div>
                <div className="text-xs text-gray-600">{p.id}</div>
                <button
                  type="button"
                  onClick={() => toggleOpenAndLoad(p)}
                  className="mt-2 text-blue-700 text-sm underline"
                >
                  {open ? 'Hide' : 'Manage'} fitments
                </button>
              </div>
              <div className="p-3">
                {/* Existing fitments */}
                {fList.length > 0 ? (
                  <ul className="space-y-1 mb-2">
                    {fList.map(f => (
                      <li key={f.id} className="text-sm text-gray-900 flex items-center justify-between">
                        <span>
                          {f.yearFrom ?? '—'}–{f.yearTo ?? '—'} • {f.make} {f.model}
                          {f.trim ? ` • ${f.trim}` : ''}
                          {f.chassis ? ` • ${f.chassis}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFitment(f)}
                          className="text-red-700 text-xs underline ml-2"
                          title="Remove fitment"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-700 mb-2">No fitments yet.</div>
                )}

                {/* Add form */}
                {open && (
                  <div className="bg-gray-50 rounded p-2 space-y-2 border">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="block text-xs text-gray-700 mb-1">Year From</span>
                        <input
                          className="border rounded p-1 w-full text-gray-900"
                          value={form.yearFrom}
                          onChange={e => onChangeForm(p.id, { yearFrom: e.target.value })}
                          placeholder="e.g., 2016"
                          inputMode="numeric"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs text-gray-700 mb-1">Year To</span>
                        <input
                          className="border rounded p-1 w-full text-gray-900"
                          value={form.yearTo}
                          onChange={e => onChangeForm(p.id, { yearTo: e.target.value })}
                          placeholder="e.g., 2021"
                          inputMode="numeric"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="block text-xs text-gray-700 mb-1">Make</span>
                      <select
                        className="border rounded p-1 w-full text-gray-900"
                        value={form.makeId}
                        onChange={e => onChangeForm(p.id, { makeId: e.target.value })}
                      >
                        <option value="">— Select Make —</option>
                        {makes.map(mk => (
                          <option key={mk.id} value={mk.id}>{mk.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="block text-xs text-gray-700 mb-1">Model</span>
                      <select
                        className="border rounded p-1 w-full text-gray-900"
                        value={form.modelId}
                        onChange={e => onChangeForm(p.id, { modelId: e.target.value })}
                        disabled={!form.makeId}
                      >
                        <option value="">— Select Model —</option>
                        {models.map(md => (
                          <option key={md.id} value={md.id}>{md.name}</option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="block text-xs text-gray-700 mb-1">Trim (optional)</span>
                        <select
                          className="border rounded p-1 w-full text-gray-900"
                          value={form.trimId}
                          onChange={e => onChangeForm(p.id, { trimId: e.target.value })}
                          disabled={!form.modelId}
                        >
                          <option value="">— None —</option>
                          {trims.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="block text-xs text-gray-700 mb-1">Chassis (optional)</span>
                        <select
                          className="border rounded p-1 w-full text-gray-900"
                          value={form.chassisId}
                          onChange={e => onChangeForm(p.id, { chassisId: e.target.value })}
                          disabled={!form.makeId && !form.modelId}
                        >
                          <option value="">— None —</option>
                          {chassisOptions.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded"
                        onClick={() => addFitment(p)}
                      >
                        Add Fitment
                      </button>
                      <button
                        type="button"
                        className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-3 py-1.5 rounded"
                        onClick={() => setOpenAddFor(prev => ({ ...prev, [p.id]: false }))}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {hasNext && (
          <div className="p-3 border-t flex justify-center">
            <button
              className="bg-gray-100 hover:bg-gray-200 text-gray-900 px-4 py-2 rounded"
              onClick={() => loadProducts(true)}
              disabled={loading}
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
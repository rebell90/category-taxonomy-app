'use client';

// eslint-disable-next-line @next/next/no-img-element
import { useEffect, useMemo, useState } from 'react';

/** ---------- Types ---------- */

type ProductItem = {
  id: string;           // gid://shopify/Product/123...
  title: string;
  handle: string;
  image?: string | null;
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
};

type ProductsResponse =
  | { items: ProductItem[]; nextCursor?: string | null }
  | { products: { edges: Array<{ node: ProductItem }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

type FitTerm = {
  id: string;
  type: FitTermType;
  name: string;
  parentId: string | null;
};

type FitTermsResponse = {
  rows: FitTerm[];
  tree: FitTerm[]; // not used here, but returned by your API
};

type ProductFitment = {
  id: string;
  productGid: string;
  make: string;
  model: string;
  trim?: string | null;
  chassis?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

type FitmentsListResponse = { fitments: ProductFitment[] };

type AddFitmentPayload = {
  productGid: string;
  make: string;
  model: string;
  trim?: string | null;
  chassis?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
};

/** ---------- Helpers ---------- */

function gidToNumeric(gid: string): string {
  // Accept either a gid or a plain numeric id and normalize to numeric string
  // gid looks like: gid://shopify/Product/1234567890
  const m = /\/(\d+)$/.exec(gid);
  return m ? m[1] : gid;
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

/** ---------- Page ---------- */

export default function FitmentsAuditPage(): JSX.Element {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Fit terms (for selectors)
  const [terms, setTerms] = useState<FitTerm[]>([]);
  const makes = useMemo(() => terms.filter(t => t.type === 'MAKE').sort((a,b)=>a.name.localeCompare(b.name)), [terms]);
  const models = useMemo(() => terms.filter(t => t.type === 'MODEL'), [terms]);
  const trims  = useMemo(() => terms.filter(t => t.type === 'TRIM'),  [terms]);
  const chassisTerms = useMemo(() => terms.filter(t => t.type === 'CHASSIS'), [terms]);

  // Group models by parent make
  const modelsByMake = useMemo<Record<string, FitTerm[]>>(() => {
    const out: Record<string, FitTerm[]> = {};
    for (const t of models) {
      if (t.parentId) {
        if (!out[t.parentId]) out[t.parentId] = [];
        out[t.parentId].push(t);
      }
    }
    // sort within group
    Object.values(out).forEach(arr => arr.sort((a,b)=>a.name.localeCompare(b.name)));
    return out;
  }, [models]);

  // Current fitments per product id (numeric)
  const [fitmentsByProduct, setFitmentsByProduct] = useState<Record<string, ProductFitment[]>>({});

  // Per-row pending add state
  type Draft = {
    makeId?: string;
    modelId?: string;
    trimId?: string;
    chassisId?: string;
    yearFrom?: string;
    yearTo?: string;
    saving?: boolean;
    error?: string | null;
  };
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); // key = numeric product id

  /** ----- Load fit terms ----- */
  async function loadTerms() {
    const res = await fetch('/api/fit-terms', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Load terms failed (${res.status})`);
    const json = (await res.json()) as FitTermsResponse;
    setTerms(json.rows || []);
  }

  /** ----- Load products page ----- */
  async function loadProducts(append = false) {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (append && nextCursor) qs.set('after', nextCursor);
      // If your /api/admin/products supports `first`, add qs.set('first','50') etc.

      const res = await fetch(`/api/admin/products?${qs.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Products HTTP ${res.status}: ${t}`);
      }
      const json = (await res.json()) as ProductsResponse;

      let items: ProductItem[] = [];
      let newCursor: string | null = null;
      let more = false;

      if ('items' in json) {
        items = json.items || [];
        newCursor = json.nextCursor ?? null;
        more = Boolean(newCursor);
      } else if ('products' in json) {
        const edges = json.products.edges || [];
        items = edges.map(e => e.node);
        newCursor = json.products.pageInfo?.endCursor ?? null;
        more = Boolean(json.products.pageInfo?.hasNextPage);
      }

      setProducts(prev => (append ? [...prev, ...items] : items));
      setNextCursor(newCursor);
      setHasMore(more);

      // Preload fitments for this batch
      await Promise.all(
        items.map(async p => {
          const pid = gidToNumeric(p.id);
          await refreshFitmentsFor(pid);
        })
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /** ----- Load/refresh fitments for single product ----- */
  async function refreshFitmentsFor(productNumericId: string) {
    const url = `/api/admin/fitments?productGid=${encodeURIComponent(productNumericId)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const json = (await res.json()) as FitmentsListResponse;
    setFitmentsByProduct(prev => ({ ...prev, [productNumericId]: json.fitments || [] }));
  }

  useEffect(() => {
    void loadTerms();
    void loadProducts(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ----- Draft helpers ----- */
  function setDraft(productNumericId: string, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [productNumericId]: { ...(prev[productNumericId] || {}), ...patch } }));
  }

  function resetDraft(productNumericId: string) {
    setDrafts(prev => ({ ...prev, [productNumericId]: {} }));
  }

  /** ----- Add fitment ----- */
  async function addFitment(productGidRaw: string) {
    const productNumericId = gidToNumeric(productGidRaw);
    const d = drafts[productNumericId] || {};
    setDraft(productNumericId, { saving: true, error: null });

    try {
      // Look up chosen term names
      const makeName = d.makeId ? terms.find(t => t.id === d.makeId)?.name : undefined;
      const modelName = d.modelId ? terms.find(t => t.id === d.modelId)?.name : undefined;
      const trimName  = d.trimId ? terms.find(t => t.id === d.trimId)?.name : undefined;
      const chassisNm = d.chassisId ? terms.find(t => t.id === d.chassisId)?.name : undefined;

      if (!makeName || !modelName) {
        throw new Error('Please select at least Make and Model.');
      }

      const body: AddFitmentPayload = {
        productGid: productNumericId, // API expects numeric in your examples
        make: makeName,
        model: modelName,
        trim: trimName ?? null,
        chassis: chassisNm ?? null,
        yearFrom: d.yearFrom ? Number(d.yearFrom) : null,
        yearTo: d.yearTo ? Number(d.yearTo) : null,
      };

      const res = await fetch('/api/admin/fitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Assign failed (${res.status})`);
      }

      resetDraft(productNumericId);
      await refreshFitmentsFor(productNumericId);
    } catch (e) {
      setDraft(productNumericId, { error: (e as Error).message });
    } finally {
      setDraft(productNumericId, { saving: false });
    }
  }

  /** ----- Remove fitment ----- */
  async function removeFitment(f: ProductFitment) {
    const numericId = gidToNumeric(f.productGid);
    const res = await fetch('/api/admin/fitments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: f.id }),
    });
    if (res.ok) {
      await refreshFitmentsFor(numericId);
    }
  }

  /** ----- UI bits ----- */

  function ProductRow({ p }: { p: ProductItem }) {
    const numericId = gidToNumeric(p.id);
    const current = fitmentsByProduct[numericId] || [];
    const d = drafts[numericId] || {};

    const selectedMake = d.makeId ? terms.find(t => t.id === d.makeId) : undefined;
    const modelChoices = selectedMake ? (modelsByMake[selectedMake.id] || []) : [];
    const trimChoices  = d.modelId ? trims.filter(t => t.parentId === d.modelId) : [];
    const chassisChoices = useMemo(() => {
      // Chassis may hang off Make or Model — show both possibilities filtered by selected make/model
      const fromMake = d.makeId ? chassisTerms.filter(t => t.parentId === d.makeId) : [];
      const fromModel = d.modelId ? chassisTerms.filter(t => t.parentId === d.modelId) : [];
      const merged = [...fromMake, ...fromModel];
      // de-dupe by id
      const seen = new Set<string>();
      return merged.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
    }, [chassisTerms, d.makeId, d.modelId]);

    return (
      <div className="grid grid-cols-[64px_1fr] md:grid-cols-[72px_2fr_1fr] gap-3 p-3 border rounded-lg bg-white">
        <div className="w-16 h-16 md:w-18 md:h-18 rounded overflow-hidden bg-gray-100">
          <img
            className="w-full h-full object-cover"
            src={p.image || '//cdn.shopify.com/s/images/admin/no-image-256x256.gif'}
            alt={p.title}
          />
        </div>

        <div className="space-y-2">
          <div className="font-semibold text-gray-900 leading-tight">{p.title}</div>
          <div className="text-xs text-gray-600 break-all">{p.handle}</div>

          <div className="flex flex-wrap gap-2 mt-1">
            {current.length === 0 && (
              <span className="text-xs text-gray-700">No fitments yet</span>
            )}
            {current.map(f => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 border rounded-full bg-gray-50 text-gray-800"
                title={`Years: ${f.yearFrom ?? ''}${f.yearTo ? '–'+f.yearTo : ''}`}
              >
                {f.make} {f.model}
                {f.trim ? ` ${f.trim}` : ''}{f.chassis ? ` · ${f.chassis}` : ''}
                <button
                  className="ml-1 text-red-700 hover:underline"
                  onClick={() => removeFitment(f)}
                  title="Remove"
                  aria-label="Remove fitment"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="md:col-start-3">
          <div className="grid grid-cols-2 gap-2">
            {/* Make */}
            <select
              className="border rounded p-2 text-gray-900"
              value={d.makeId || ''}
              onChange={e => {
                const makeId = e.target.value || undefined;
                setDraft(numericId, { makeId, modelId: undefined, trimId: undefined, chassisId: undefined });
              }}
            >
              <option value="">Make…</option>
              {makes.map(mk => (
                <option key={mk.id} value={mk.id}>{mk.name}</option>
              ))}
            </select>

            {/* Model */}
            <select
              className="border rounded p-2 text-gray-900"
              value={d.modelId || ''}
              onChange={e => {
                const modelId = e.target.value || undefined;
                setDraft(numericId, { modelId, trimId: undefined, chassisId: undefined });
              }}
              disabled={!d.makeId}
            >
              <option value="">Model…</option>
              {modelChoices.map(md => (
                <option key={md.id} value={md.id}>{md.name}</option>
              ))}
            </select>

            {/* Trim (optional) */}
            <select
              className="border rounded p-2 text-gray-900"
              value={d.trimId || ''}
              onChange={e => setDraft(numericId, { trimId: e.target.value || undefined })}
              disabled={!d.modelId}
            >
              <option value="">Trim (opt)…</option>
              {trimChoices.map(tr => (
                <option key={tr.id} value={tr.id}>{tr.name}</option>
              ))}
            </select>

            {/* Chassis (optional) */}
            <select
              className="border rounded p-2 text-gray-900"
              value={d.chassisId || ''}
              onChange={e => setDraft(numericId, { chassisId: e.target.value || undefined })}
              disabled={!d.makeId && !d.modelId}
            >
              <option value="">Chassis (opt)…</option>
              {chassisChoices.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>

            {/* Years */}
            <input
              className="border rounded p-2 text-gray-900"
              placeholder="Year From"
              inputMode="numeric"
              value={d.yearFrom || ''}
              onChange={e => setDraft(numericId, { yearFrom: e.target.value })}
            />
            <input
              className="border rounded p-2 text-gray-900"
              placeholder="Year To"
              inputMode="numeric"
              value={d.yearTo || ''}
              onChange={e => setDraft(numericId, { yearTo: e.target.value })}
            />
          </div>

          {d.error && <div className="text-sm text-red-700 mt-1">{d.error}</div>}

          <div className="mt-2 flex gap-2">
            <button
              className={classNames(
                'px-3 py-1 rounded text-white',
                d.saving ? 'bg-blue-400 cursor-wait' : 'bg-blue-700 hover:bg-blue-800'
              )}
              disabled={d.saving}
              onClick={() => addFitment(p.id)}
            >
              {d.saving ? 'Saving…' : 'Add Fitment'}
            </button>
            <button
              className="px-3 py-1 rounded border text-gray-900 hover:bg-gray-50"
              onClick={() => resetDraft(numericId)}
              disabled={d.saving}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-3">Fitments Audit</h1>
      <p className="text-sm text-gray-700 mb-4">
        Quickly review products and assign <strong>Make / Model / (Trim) / (Chassis)</strong> and optional <strong>year range</strong>.
      </p>

      {err && (
        <div className="mb-3 p-3 border rounded bg-red-50 text-red-800">
          {err}
        </div>
      )}

      <div className="space-y-3">
        {products.length === 0 && !loading && (
          <div className="text-gray-800">No products found.</div>
        )}

        {products.map(p => (
          <ProductRow key={p.id} p={p} />
        ))}
      </div>

      <div className="mt-4">
        {hasMore ? (
          <button
            className={classNames(
              'px-4 py-2 rounded text-white',
              loading ? 'bg-gray-400 cursor-wait' : 'bg-gray-800 hover:bg-black'
            )}
            onClick={() => loadProducts(true)}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : (
          <div className="text-sm text-gray-600">End of list</div>
        )}
      </div>
    </main>
  );
}
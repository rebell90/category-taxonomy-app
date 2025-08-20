'use client';

import { useEffect, useMemo, useState } from 'react';

// ---------- Types ----------
type ProductSummary = {
  id: string;              // Shopify GID
  title: string;
  handle: string;
  imageUrl?: string | null;
};

type FitmentRow = {
  id: string;
  productGid: string;
  yearFrom: number | null;
  yearTo: number | null;
  make: string | null;
  model: string | null;
  trim?: string | null;
  chassis?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

// ---------- Small utils (null-safe) ----------
function emptyToNull(s?: string | null): string | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function intOrNull(s?: string | null): number | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}
function clampYear(n: number | null, min = 1900, max = 2100): number | null {
  if (n == null) return null;
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
function yn(b?: boolean) {
  return b ? 'Yes' : 'No';
}

// ---------- Server calls (adjust if your endpoints differ) ----------
async function fetchProducts(search: string): Promise<ProductSummary[]> {
  const url = `/api/admin/products?search=${encodeURIComponent(search)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch products ${res.status}`);
  const json = await res.json();
  // Normalize expected fields
  const list = Array.isArray(json.products) ? json.products : json;
  return (list as any[]).map((p) => ({
    id: String(p.id),
    title: String(p.title ?? ''),
    handle: String(p.handle ?? ''),
    imageUrl: p.imageUrl ?? p.image?.src ?? null,
  })) as ProductSummary[];
}

async function fetchFitments(productGid: string): Promise<FitmentRow[]> {
  const url = `/api/admin/fitments?productGid=${encodeURIComponent(productGid)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch fitments ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json as FitmentRow[] : (json.fitments ?? []);
}

async function createFitment(row: Omit<FitmentRow, 'id' | 'createdAt' | 'updatedAt'>): Promise<FitmentRow> {
  const res = await fetch('/api/admin/fitments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Create ${res.status}: ${txt}`);
  }
  return await res.json();
}

async function updateFitment(row: FitmentRow): Promise<FitmentRow> {
  const res = await fetch('/api/admin/fitments', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Update ${res.status}: ${txt}`);
  }
  return await res.json();
}

async function deleteFitment(id: string, productGid: string): Promise<void> {
  const res = await fetch('/api/admin/fitments', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, productGid }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Delete ${res.status}: ${txt}`);
  }
}

// ---------- Main Component ----------
export default function FitmentsPage() {
  // UI state
  const [search, setSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [selected, setSelected] = useState<ProductSummary | null>(null);

  const [loadingFitments, setLoadingFitments] = useState(false);
  const [fitments, setFitments] = useState<FitmentRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state (for add or edit)
  const [editing, setEditing] = useState<FitmentRow | null>(null);
  const isEditing = useMemo(() => Boolean(editing && editing.id), [editing]);

  // Fetch products on search
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        setLoadingProducts(true);
        const list = await fetchProducts(search);
        if (!abort) {
          setProducts(list);
          // Keep selection if still present
          if (selected) {
            const stillThere = list.find((p) => p.id === selected.id);
            if (!stillThere) {
              setSelected(null);
              setFitments([]);
            }
          }
        }
      } catch (e: any) {
        if (!abort) setErrorMsg(e?.message ?? String(e));
      } finally {
        if (!abort) setLoadingProducts(false);
      }
    })();
    return () => { abort = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Fetch fitments for selected product
  useEffect(() => {
    if (!selected) {
      setFitments([]);
      return;
    }
    let abort = false;
    (async () => {
      try {
        setLoadingFitments(true);
        const rows = await fetchFitments(selected.id);
        if (!abort) setFitments(rows);
      } catch (e: any) {
        if (!abort) setErrorMsg(e?.message ?? String(e));
      } finally {
        if (!abort) setLoadingFitments(false);
      }
    })();
    return () => { abort = true; };
  }, [selected]);

  // Handlers
  function startAdd() {
    if (!selected) return;
    setEditing({
      id: '', // empty id indicates "new"
      productGid: selected.id,
      yearFrom: null,
      yearTo: null,
      make: null,
      model: null,
      trim: null,
      chassis: null,
    });
  }

  function startEdit(row: FitmentRow) {
    // clone to avoid editing the table row object directly
    setEditing({ ...row });
  }

  function cancelEdit() {
    setEditing(null);
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!editing) return;
    try {
      const payload: FitmentRow = {
        ...editing,
        productGid: editing.productGid,
        yearFrom: clampYear(editing.yearFrom),
        yearTo: clampYear(editing.yearTo),
        make: emptyToNull(editing.make),
        model: emptyToNull(editing.model),
        trim: emptyToNull(editing.trim),
        chassis: emptyToNull(editing.chassis),
      };

      // validate basic required fields
      if (!payload.productGid) throw new Error('Missing productGid');
      if (!payload.make || !payload.model) throw new Error('Make and Model are required');

      let saved: FitmentRow;
      if (isEditing && editing.id) {
        saved = await updateFitment(payload);
      } else {
        const { id, ...createBody } = payload;
        saved = await createFitment(createBody as Omit<FitmentRow, 'id'>);
      }

      // upsert locally
      setFitments((prev) => {
        const i = prev.findIndex((r) => r.id === saved.id);
        if (i >= 0) {
          const next = prev.slice();
          next[i] = saved;
          return next;
        }
        return [saved, ...prev];
      });

      setEditing(null);
      setSuccessMsg('Saved.');
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e));
    }
  }

  async function remove(row: FitmentRow) {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await deleteFitment(row.id, row.productGid);
      setFitments((prev) => prev.filter((r) => r.id !== row.id));
      setSuccessMsg('Deleted.');
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e));
    }
  }

  // ---------- UI ----------
  return (
    <main className="flex min-h-[calc(100vh-4rem)] text-neutral-900">
      {/* Sidebar: product search/list */}
      <aside className="w-80 shrink-0 border-r border-neutral-200 bg-neutral-50">
        <div className="p-3 border-b border-neutral-200">
          <h1 className="text-lg font-semibold">Fitments</h1>
          <p className="text-sm text-neutral-600">Assign Year/Make/Model</p>
        </div>
        <div className="p-3 border-b border-neutral-200">
          <input
            className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="overflow-auto">
          {loadingProducts ? (
            <div className="p-3 text-sm text-neutral-600">Loading products…</div>
          ) : products.length === 0 ? (
            <div className="p-3 text-sm text-neutral-600">No products.</div>
          ) : (
            <ul>
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    className={`flex w-full gap-3 p-3 text-left hover:bg-neutral-100 ${
                      selected?.id === p.id ? 'bg-neutral-100' : ''
                    }`}
                    onClick={() => setSelected(p)}
                  >
                    {/* Using <img> to avoid next/image warnings server-side */}
                    {p.imageUrl ? (
                      <img
                        className="h-10 w-10 rounded border border-neutral-200 object-cover"
                        src={p.imageUrl}
                        alt=""
                      />
                    ) : (
                      <div className="h-10 w-10 rounded border border-neutral-200 bg-neutral-100" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-neutral-900">{p.title}</div>
                      <div className="truncate text-[12px] text-neutral-600">{p.handle}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Main panel */}
      <section className="flex-1 overflow-auto">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-5 py-3">
          <div>
            <div className="text-base font-semibold text-neutral-900">
              {selected ? selected.title : 'Select a product'}
            </div>
            {selected && (
              <div className="text-sm text-neutral-600">@{selected.handle}</div>
            )}
          </div>
          {selected && (
            <button
              onClick={startAdd}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Add Fitment
            </button>
          )}
        </header>

        {/* Alerts */}
        {(errorMsg || successMsg) && (
          <div className="px-5 pt-4">
            {errorMsg && (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMsg}
              </div>
            )}
            {successMsg && (
              <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {successMsg}
              </div>
            )}
          </div>
        )}

        {/* Table or empty */}
        {!selected ? (
          <div className="p-5 text-sm text-neutral-700">Search and select a product to manage fitments.</div>
        ) : loadingFitments ? (
          <div className="p-5 text-sm text-neutral-700">Loading fitments…</div>
        ) : fitments.length === 0 ? (
          <div className="p-5 text-sm text-neutral-700">No fitments yet.</div>
        ) : (
          <div className="p-5">
            <div className="overflow-x-auto rounded-md border border-neutral-200">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-700">
                    <th className="border-b border-neutral-200 px-3 py-2 text-left text-sm font-medium">Years</th>
                    <th className="border-b border-neutral-200 px-3 py-2 text-left text-sm font-medium">Make</th>
                    <th className="border-b border-neutral-200 px-3 py-2 text-left text-sm font-medium">Model</th>
                    <th className="border-b border-neutral-200 px-3 py-2 text-left text-sm font-medium">Trim</th>
                    <th className="border-b border-neutral-200 px-3 py-2 text-left text-sm font-medium">Chassis</th>
                    <th className="border-b border-neutral-200 px-3 py-2 text-left text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {fitments.map((r) => (
                    <tr key={r.id} className="odd:bg-white even:bg-neutral-50">
                      <td className="border-b border-neutral-200 px-3 py-2 text-sm text-neutral-900">
                        {r.yearFrom ?? '—'} {r.yearTo ? `– ${r.yearTo}` : ''}
                      </td>
                      <td className="border-b border-neutral-200 px-3 py-2 text-sm text-neutral-900">{r.make ?? '—'}</td>
                      <td className="border-b border-neutral-200 px-3 py-2 text-sm text-neutral-900">{r.model ?? '—'}</td>
                      <td className="border-b border-neutral-200 px-3 py-2 text-sm text-neutral-900">{r.trim ?? '—'}</td>
                      <td className="border-b border-neutral-200 px-3 py-2 text-sm text-neutral-900">{r.chassis ?? '—'}</td>
                      <td className="border-b border-neutral-200 px-3 py-2 text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEdit(r)}
                            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => remove(r)}
                            className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Drawer / Form */}
        {editing && (
          <div className="px-5 pb-8">
            <form
              onSubmit={submitEdit}
              className="mt-2 grid grid-cols-1 gap-3 rounded-md border border-neutral-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-800">Year From</label>
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  value={editing.yearFrom ?? ''}
                  onChange={(e) => setEditing({ ...editing, yearFrom: clampYear(intOrNull(e.target.value)) })}
                  className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900"
                  placeholder="e.g. 2005"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-800">Year To</label>
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  value={editing.yearTo ?? ''}
                  onChange={(e) => setEditing({ ...editing, yearTo: clampYear(intOrNull(e.target.value)) })}
                  className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900"
                  placeholder="e.g. 2010"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-800">Make *</label>
                <input
                  value={editing.make ?? ''}
                  onChange={(e) => setEditing({ ...editing, make: emptyToNull(e.target.value) })}
                  className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900"
                  placeholder="e.g. Porsche"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-800">Model *</label>
                <input
                  value={editing.model ?? ''}
                  onChange={(e) => setEditing({ ...editing, model: emptyToNull(e.target.value) })}
                  className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900"
                  placeholder="e.g. 911"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-800">Trim (optional)</label>
                <input
                  value={editing.trim ?? ''}
                  onChange={(e) => setEditing({ ...editing, trim: emptyToNull(e.target.value) })}
                  className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900"
                  placeholder="e.g. GT3 RS"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-800">Chassis (optional)</label>
                <input
                  value={editing.chassis ?? ''}
                  onChange={(e) => setEditing({ ...editing, chassis: emptyToNull(e.target.value) })}
                  className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm text-neutral-900"
                  placeholder="e.g. 992"
                />
              </div>

              <div className="col-span-full mt-2 flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {isEditing ? 'Update' : 'Add fitment'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
                >
                  Cancel
                </button>
                <span className="text-xs text-neutral-600">
                  Required: Make & Model. Years optional (range), Trim/Chassis optional.
                </span>
              </div>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
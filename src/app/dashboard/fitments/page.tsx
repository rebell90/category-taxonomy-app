// src/app/dashboard/fitments/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

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

type NewFitment = {
  productGid: string;
  make: string;
  model: string;
  yearFrom?: number | null;
  yearTo?: number | null;
  trim?: string | null;
  chassis?: string | null;
};

export default function FitmentsPage() {
  const [fitments, setFitments] = useState<Fitment[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<NewFitment>({
    productGid: '',
    make: '',
    model: '',
    yearFrom: undefined,
    yearTo: undefined,
    trim: '',
    chassis: '',
  });
  const [filters, setFilters] = useState<{ productGid: string; make: string; model: string; year: string }>({
    productGid: '',
    make: '',
    model: '',
    year: '',
  });

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.productGid) params.set('productGid', filters.productGid);
    if (filters.make) params.set('make', filters.make);
    if (filters.model) params.set('model', filters.model);
    if (filters.year) params.set('year', filters.year);

    const res = await fetch(`/api/admin/fitments?${params.toString()}`, { cache: 'no-store' });
    const data = (await res.json()) as Fitment[];
    setFitments(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.productGid || !form.make || !form.model) return;

    const res = await fetch('/api/admin/fitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productGid: form.productGid.trim(),
        make: form.make.trim(),
        model: form.model.trim(),
        yearFrom: numberOrNull(form.yearFrom),
        yearTo: numberOrNull(form.yearTo),
        trim: emptyToNull(form.trim),
        chassis: emptyToNull(form.chassis),
      } satisfies NewFitment),
    });

    if (res.ok) {
      await load();
      setForm({
        productGid: '',
        make: '',
        model: '',
        yearFrom: undefined,
        yearTo: undefined,
        trim: '',
        chassis: '',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      alert('Create failed' + (err?.error ? `: ${err.error}` : ''));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this fitment?')) return;
    const res = await fetch('/api/admin/fitments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setFitments(prev => prev.filter(f => f.id !== id));
    } else {
      const err = await res.json().catch(() => ({}));
      alert('Delete failed' + (err?.error ? `: ${err.error}` : ''));
    }
  };

  const handleInlineUpdate = async (id: string, partial: Partial<Fitment>) => {
    const res = await fetch('/api/admin/fitments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...partial }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Update failed' + (err?.error ? `: ${err.error}` : ''));
      return;
    }
    const updated = (await res.json()) as Fitment;
    setFitments(prev => prev.map(f => (f.id === id ? updated : f)));
  };

  const filteredCount = useMemo(() => fitments.length, [fitments]);

  return (
    <main className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Fitments</h1>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to Dashboard</Link>
      </div>

      {/* Filters */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Filters</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Product GID (gid://shopify/Product/123...)"
            value={filters.productGid}
            onChange={e => setFilters(s => ({ ...s, productGid: e.target.value }))}
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Make"
            value={filters.make}
            onChange={e => setFilters(s => ({ ...s, make: e.target.value }))}
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Model"
            value={filters.model}
            onChange={e => setFilters(s => ({ ...s, model: e.target.value }))}
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Year (exact)"
            value={filters.year}
            onChange={e => setFilters(s => ({ ...s, year: e.target.value }))}
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            onClick={() => void load()}
          >
            Apply
          </button>
          <button
            className="rounded border border-gray-300 bg-white px-4 py-2 text-gray-800 hover:bg-gray-50"
            onClick={() => {
              setFilters({ productGid: '', make: '', model: '', year: '' });
              void load();
            }}
          >
            Reset
          </button>
        </div>
      </section>

      {/* Create */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-medium text-gray-900">Add Fitment</h2>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={handleCreate}>
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Product GID"
            value={form.productGid}
            onChange={e => setForm(f => ({ ...f, productGid: e.target.value }))}
            required
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Make"
            value={form.make}
            onChange={e => setForm(f => ({ ...f, make: e.target.value }))}
            required
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Model"
            value={form.model}
            onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
            required
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Year From"
            inputMode="numeric"
            value={form.yearFrom ?? ''}
            onChange={e => setForm(f => ({ ...f, yearFrom: asNumOrEmpty(e.target.value) }))}
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Year To"
            inputMode="numeric"
            value={form.yearTo ?? ''}
            onChange={e => setForm(f => ({ ...f, yearTo: asNumOrEmpty(e.target.value) }))}
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Trim (optional)"
            value={form.trim ?? ''}
            onChange={e => setForm(f => ({ ...f, trim: e.target.value }))}
          />
          <input
            className="rounded border border-gray-300 p-2 text-gray-900"
            placeholder="Chassis (optional)"
            value={form.chassis ?? ''}
            onChange={e => setForm(f => ({ ...f, chassis: e.target.value }))}
          />
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
              disabled={loading}
            >
              {loading ? 'Saving…' : 'Add Fitment'}
            </button>
          </div>
        </form>
      </section>

      {/* Table */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm text-gray-700">
          Showing <strong>{filteredCount}</strong> fitment{filteredCount === 1 ? '' : 's'}
        </div>
        <div className="overflow-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left text-sm font-semibold text-gray-900">
                <th className="border-b border-gray-200 px-3 py-2">Product GID</th>
                <th className="border-b border-gray-200 px-3 py-2">Make</th>
                <th className="border-b border-gray-200 px-3 py-2">Model</th>
                <th className="border-b border-gray-200 px-3 py-2">Year From</th>
                <th className="border-b border-gray-200 px-3 py-2">Year To</th>
                <th className="border-b border-gray-200 px-3 py-2">Trim</th>
                <th className="border-b border-gray-200 px-3 py-2">Chassis</th>
                <th className="border-b border-gray-200 px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {fitments.map((f) => (
                <tr key={f.id} className="text-sm text-gray-900">
                  <td className="border-b border-gray-100 px-3 py-2">{f.productGid}</td>
                  <td className="border-b border-gray-100 px-3 py-2">
                    <InlineEdit value={f.make} onSave={(v) => handleInlineUpdate(f.id, { make: v })} />
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2">
                    <InlineEdit value={f.model} onSave={(v) => handleInlineUpdate(f.id, { model: v })} />
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2">
                    <InlineEdit value={numOrEmpty(f.yearFrom)} numeric onSave={(v) => handleInlineUpdate(f.id, { yearFrom: v ? Number(v) : null })} />
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2">
                    <InlineEdit value={numOrEmpty(f.yearTo)} numeric onSave={(v) => handleInlineUpdate(f.id, { yearTo: v ? Number(v) : null })} />
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2">
                    <InlineEdit value={f.trim ?? ''} onSave={(v) => handleInlineUpdate(f.id, { trim: v || null })} />
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2">
                    <InlineEdit value={f.chassis ?? ''} onSave={(v) => handleInlineUpdate(f.id, { chassis: v || null })} />
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2">
                    <button
                      className="rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50"
                      onClick={() => void handleDelete(f.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}

              {!fitments.length && (
                <tr>
                  <td className="px-3 py-6 text-sm text-gray-600" colSpan={8}>
                    No fitments found. Add one above or adjust your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

// ---- helpers

function numberOrNull(n?: number | null): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
function asNumOrEmpty(s: string): number | undefined {
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function emptyToNull(s?: string | null): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length ? trimmed : null;
}

function numOrEmpty(n: number | null): string {
  return typeof n === 'number' ? String(n) : '';
}

// tiny inline edit component
function InlineEdit({
  value,
  onSave,
  numeric,
}: {
  value: string;
  onSave: (v: string) => void | Promise<void>;
  numeric?: boolean;
}) {
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);

  return (
    <div className="flex items-center gap-2">
      <input
        className="w-full rounded border border-gray-300 p-1 text-gray-900"
        value={val}
        inputMode={numeric ? 'numeric' : undefined}
        onChange={(e) => setVal(e.target.value)}
      />
      <button
        className="rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
        onClick={() => void onSave(val)}
      >
        Save
      </button>
    </div>
  );
}
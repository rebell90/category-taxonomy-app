'use client';

import { useEffect, useMemo, useState } from 'react';

type FitTermType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

type FitTerm = {
  id: string;
  type: FitTermType;
  name: string;
  parentId: string | null;
  children?: FitTerm[];
};

type TreeResponse = { rows: FitTerm[]; tree: FitTerm[] };

const TYPE_LABELS: Record<FitTermType, string> = {
  MAKE: 'Make',
  MODEL: 'Model',
  TRIM: 'Trim',
  CHASSIS: 'Chassis',
};

export default function FitTermsPage() {
  const [tree, setTree] = useState<FitTerm[]>([]);
  const [flat, setFlat] = useState<FitTerm[]>([]);
  const [type, setType] = useState<FitTermType>('MAKE');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [editing, setEditing] = useState<FitTerm | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const makes = useMemo(() => flat.filter(f => f.type === 'MAKE'), [flat]);
  const models = useMemo(() => flat.filter(f => f.type === 'MODEL'), [flat]);

  const validParents = useMemo(() => {
    if (type === 'MODEL') return makes;
    if (type === 'TRIM')  return models;
    return []; // MAKE, CHASSIS default to no parent (or you can allow any)
  }, [type, makes, models]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/fit-terms', { cache: 'no-store' });
      const json = (await res.json()) as TreeResponse;
      setTree(json.tree);
      setFlat(json.rows);
    } catch (e) {
      setErr('Failed to load fit terms');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setEditing(null);
    setType('MAKE');
    setName('');
    setParentId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const payload: Record<string, unknown> = {
      type,
      name: name.trim(),
    };
    if (parentId) payload.parentId = parentId;

    try {
      const res = await fetch('/api/fit-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Create failed (${res.status})`);
      }
      resetForm();
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setErr(null);
    try {
      const res = await fetch('/api/fit-terms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          name: name.trim(),
          // Allow reparent from UI if you want:
          parentId: parentId === '' ? null : parentId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Update failed (${res.status})`);
      }
      resetForm();
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this term? (Children must be removed first)')) return;
    setErr(null);
    try {
      const res = await fetch('/api/fit-terms', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Delete failed (${res.status})`);
      }
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    }
  }

  function startEdit(term: FitTerm) {
    setEditing(term);
    setType(term.type);
    setName(term.name);
    setParentId(term.parentId);
  }

  function renderTree(nodes: FitTerm[], depth = 0): JSX.Element | null {
    if (!nodes.length) return null;
    return (
      <ul className="ml-0 pl-0 space-y-1">
        {nodes.map(n => (
          <li key={n.id}>
            <div className="flex items-center gap-2">
              <span className="text-gray-900 font-medium">
                {TYPE_LABELS[n.type]}:
              </span>
              <span className="text-gray-800">{n.name}</span>
              <button
                type="button"
                onClick={() => startEdit(n)}
                className="text-blue-700 text-xs underline"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(n.id)}
                className="text-red-700 text-xs underline"
              >
                Delete
              </button>
            </div>
            {n.children && n.children.length > 0 && (
              <div className="ml-4 border-l pl-4">
                {renderTree(n.children, depth + 1)}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Manage Fitments</h1>

      <form
        onSubmit={editing ? handleUpdate : handleSubmit}
        className="mb-6 space-y-3 bg-white border rounded-xl p-4 shadow-sm"
      >
        {err && <div className="text-red-700">{err}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">Type</span>
            <select
              value={type}
              onChange={e => {
                const t = e.target.value as FitTermType;
                setType(t);
                // reset parent when switching types
                setParentId(null);
              }}
              className="border rounded-md p-2 w-full text-gray-900"
              disabled={!!editing}
            >
              <option value="MAKE">Make</option>
              <option value="MODEL">Model</option>
              <option value="TRIM">Trim</option>
              <option value="CHASSIS">Chassis</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">Name</span>
            <input
              className="border rounded-md p-2 w-full text-gray-900"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Honda / Civic / Si / E90"
            />
          </label>

          {(type === 'MODEL' || type === 'TRIM') && (
            <label className="block">
              <span className="block text-sm font-medium text-gray-800 mb-1">
                Parent {type === 'MODEL' ? 'Make' : 'Model'}
              </span>
              <select
                className="border rounded-md p-2 w-full text-gray-900"
                value={parentId || ''}
                onChange={e => setParentId(e.target.value || null)}
              >
                <option value="">— Select —</option>
                {validParents.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded"
          >
            {editing ? 'Update' : 'Add'} Fitment
          </button>
          {editing && (
            <button
              type="button"
              onClick={resetForm}
              className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-4 py-2 rounded"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <h2 className="text-xl font-semibold text-gray-900 mb-2">Fitments Tree</h2>
      <div className="bg-white border rounded-xl p-4 shadow-sm">
        {loading ? <div className="text-gray-700">Loading…</div> : renderTree(tree || [])}
      </div>
    </main>
  );
}
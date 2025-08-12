'use client'

import { useEffect, useState } from 'react'

type Category = {
  id: string
  title: string
  slug: string
  parentId: string | null
  children?: Category[]
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Category | null>(null)
  const [loading, setLoading] = useState(false)

  const loadCategories = async () => {
    const res = await fetch('/api/categories', { cache: 'no-store' })
    const data = await res.json()
    setCategories(data)
  }

  useEffect(() => { loadCategories() }, [])

  const slugify = (input: string) =>
    input.toLowerCase()
      .replace(/\s*&\s*/g, '-')      // " & " -> "-"
      .replace(/\s+/g, '-')          // spaces -> "-"
      .replace(/[^a-z0-9\-]/g, '')   // drop non alphanumerics
      .replace(/--+/g, '-')          // collapse ---
      .replace(/^-+|-+$/g, '')       // trim

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, slug, parentId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert('Create failed: ' + (err.error || res.statusText))
        return
      }
      await loadCategories()
      setTitle(''); setSlug(''); setParentId(null)
    } finally { setLoading(false) }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setLoading(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, title, slug, parentId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert('Update failed: ' + (err.error || res.statusText))
        return
      }
      await loadCategories()
      setEditing(null); setTitle(''); setSlug(''); setParentId(null)
    } finally { setLoading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category?')) return
    setLoading(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert('Delete failed: ' + (err.error || res.statusText))
        return
      }
      await loadCategories()
    } finally { setLoading(false) }
  }

  const renderTree = (nodes: Category[]) => (
    <ul className="ml-4 list-disc">
      {nodes.map(cat => (
        <li key={cat.id}>
          <div className="flex flex-wrap items-center gap-2 py-1">
            <span className="font-medium">{cat.title}</span>
            <span className="text-xs text-gray-500">({cat.slug})</span>
            <button onClick={() => handleDelete(cat.id)} className="text-red-600 text-xs underline">Delete</button>
            <button
              onClick={() => { setEditing(cat); setTitle(cat.title); setSlug(cat.slug); setParentId(cat.parentId) }}
              className="text-blue-600 text-xs underline"
            >
              Edit
            </button>
          </div>
          {cat.children?.length ? renderTree(cat.children) : null}
        </li>
      ))}
    </ul>
  )

  const flattenCategories = (node: Category, level = 0): { id: string; title: string; indent: string }[] => {
    const rows = [{ id: node.id, title: node.title, indent: '— '.repeat(level) }]
    node.children?.forEach(c => rows.push(...flattenCategories(c, level + 1)))
    return rows
  }

  return (
    <section className="space-y-6">
      <form onSubmit={editing ? handleUpdate : handleSubmit} className="space-y-3 p-4 border rounded">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Title</label>
          <input
            className="border p-2 rounded"
            placeholder="e.g., Exhaust Systems"
            value={title}
            onChange={e => {
              const t = e.target.value
              setTitle(t)
              if (!editing) setSlug(slugify(t))
            }}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">Slug</label>
          <input
            className="border p-2 rounded"
            placeholder="exhaust-systems"
            value={slug}
            onChange={e => setSlug(slugify(e.target.value))}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">Parent Category</label>
          <select
            className="border p-2 rounded"
            value={parentId ?? ''}
            onChange={e => setParentId(e.target.value || null)}
          >
            <option value="">No Parent (Top Level)</option>
            {categories.flatMap(cat => flattenCategories(cat).map(o => (
              <option key={o.id} value={o.id}>{o.indent + o.title}</option>
            )))}
          </select>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-60" disabled={loading}>
            {editing ? 'Update Category' : 'Add Category'}
          </button>
          {editing && (
            <button
              type="button"
              className="bg-gray-200 px-4 py-2 rounded"
              onClick={() => { setEditing(null); setTitle(''); setSlug(''); setParentId(null) }}
            >
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div>
        <h2 className="text-xl font-semibold mb-2">Category Tree</h2>
        {categories.length ? renderTree(categories) : <p className="text-sm text-gray-500">No categories yet.</p>}
      </div>
    </section>
  )
}
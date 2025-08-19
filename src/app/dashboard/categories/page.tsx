// /src/app/categories/page.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Category = {
  id: string
  title: string
  slug: string
  parentId: string | null
  image: string | null
  description: string | null
  children?: Category[]
}

export default function CategoriesPage() {
  const [tree, setTree] = useState<Category[]>([])
  const [flat, setFlat] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [image, setImage] = useState<string>('')
  const [description, setDescription] = useState<string>('')

  const [editing, setEditing] = useState<Category | null>(null)

  const loadCategories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/categories', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Category[] = await res.json()
      setTree(data)

      // Build a flattened array for the parent dropdown
      const accumulate = (nodes: Category[], out: Category[] = [], level = 0): Category[] => {
        nodes.forEach((n) => {
          out.push({ ...n, title: `${'— '.repeat(level)}${n.title}` })
          if (n.children?.length) accumulate(n.children, out, level + 1)
        })
        return out
      }
      setFlat(accumulate(data, []))
    } catch (e) {
      console.error(e)
      setError('Failed to load categories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  // Auto-slugify from title (with & → -, multi-dash collapse)
  useEffect(() => {
    if (editing) return // do not autoslug while editing unless user types
    const s = title
      .toLowerCase()
      .trim()
      .replace(/&/g, '-')      // replace & with dash
      .replace(/\s+/g, '-')    // spaces to dashes
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')     // collapse dashes
    setSlug(s)
  }, [title, editing])

  const resetForm = () => {
    setTitle('')
    setSlug('')
    setParentId(null)
    setImage('')
    setDescription('')
    setEditing(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const payload = {
      title: title.trim(),
      slug: slug.trim(),
      parentId: parentId || null,
      image: image.trim() || null,
      description: description.trim() || null,
    }

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Create failed: ${await res.text()}`)
      await loadCategories()
      resetForm()
    } catch (e) {
      console.error(e)
      setError('Create failed')
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setError(null)

    const payload = {
      id: editing.id,
      title: title.trim(),
      slug: slug.trim(),
      // parentId not editable while editing in this simple UI; keep current
      parentId: editing.parentId,
      image: image.trim() || null,
      description: description.trim() || null,
    }

    try {
      const res = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Update failed: ${await res.text()}`)
      await loadCategories()
      resetForm()
    } catch (e) {
      console.error(e)
      setError('Update failed')
    }
  }

  const handleDelete = async (id: string) => {
    setError(null)
    try {
      const res = await fetch('/api/categories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`Delete failed: ${await res.text()}`)
      await loadCategories()
      if (editing?.id === id) resetForm()
    } catch (e) {
      console.error(e)
      setError('Delete failed')
    }
  }

  const beginEdit = (cat: Category) => {
    setEditing(cat)
    setTitle(cat.title)
    setSlug(cat.slug)
    setParentId(cat.parentId)
    setImage(cat.image ?? '')
    setDescription(cat.description ?? '')
  }

  const renderTree = (nodes: Category[]) => (
    <ul className="ml-4 list-disc space-y-1">
      {nodes.map((cat) => (
        <li key={cat.id}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">{cat.title}</span>
            <span className="text-xs text-gray-600">/ {cat.slug}</span>
            {cat.image && <span className="text-xs text-gray-600">(img)</span>}
            <button
              onClick={() => beginEdit(cat)}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              Edit
            </button>
            <button
              onClick={() => handleDelete(cat.id)}
              className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </button>
          </div>
          {cat.children && cat.children.length > 0 && renderTree(cat.children)}
        </li>
      ))}
    </ul>
  )

  const parentOptions = useMemo(
    () => [{ id: '', title: '(None)' }, ...flat.map((c) => ({ id: c.id, title: c.title }))],
    [flat]
  )

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Manage Category Tree</h1>

      <form
        onSubmit={editing ? handleUpdate : handleSubmit}
        className="mb-8 grid gap-3 max-w-2xl"
      >
        {error && <div className="text-red-700 bg-red-50 border border-red-200 p-2 rounded">{error}</div>}

        <div className="grid gap-1">
          <label className="text-sm font-medium text-gray-900">Title</label>
          <input
            className="border rounded p-2 text-gray-900"
            placeholder="e.g., Aerodynamics"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium text-gray-900">Slug</label>
          <input
            className="border rounded p-2 text-gray-900"
            placeholder="e.g., aerodynamics"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <p className="text-xs text-gray-600">Auto-generates from Title (replaces “&” with “-”, cleans spaces/symbols).</p>
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium text-gray-900">Parent</label>
          <select
            className="border rounded p-2 text-gray-900"
            value={parentId ?? ''}
            onChange={(e) => setParentId(e.target.value || null)}
            disabled={!!editing} // keep simple for now
          >
            {parentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.title}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium text-gray-900">Image URL (optional)</label>
          <input
            className="border rounded p-2 text-gray-900"
            placeholder="https://…"
            value={image}
            onChange={(e) => setImage(e.target.value)}
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium text-gray-900">Description (optional)</label>
          <textarea
            className="border rounded p-2 text-gray-900"
            placeholder="Short blurb for this category…"
            value={description}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            {editing ? 'Update Category' : 'Add Category'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-2 rounded border text-gray-900 hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <h2 className="text-xl font-semibold text-gray-900 mb-2">Category Tree</h2>
      {loading ? (
        <div className="text-gray-700">Loading…</div>
      ) : (
        renderTree(tree)
      )}
    </main>
  )
}
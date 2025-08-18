'use client'

import { useEffect, useMemo, useState } from 'react'

type Category = {
  id: string
  title: string
  slug: string
  parentId: string | null
  image?: string | null
  description?: string | null
  children?: Category[]
}

type CategoryNode = Category & { children?: CategoryNode[] }

const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, '-')      // "Merch & Apparel" -> "merch-apparel"
    .replace(/[\s_]+/g, '-')       // spaces/underscores -> dashes
    .replace(/[^a-z0-9-]/g, '')    // remove non-url chars
    .replace(/--+/g, '-')          // collapse multiple dashes
    .replace(/^-+|-+$/g, '')       // trim dashes

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryNode[]>([])
  const [filter, setFilter] = useState('')

  // form state
  const [editing, setEditing] = useState<CategoryNode | null>(null)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [image, setImage] = useState('')
  const [description, setDescription] = useState('')

  // expand/collapse state for tree (persist per session)
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      return JSON.parse(sessionStorage.getItem('cat_open') || '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })

  useEffect(() => {
    sessionStorage.setItem('cat_open', JSON.stringify(open))
  }, [open])

  async function loadCategories() {
    const res = await fetch('/api/categories', { cache: 'no-store' })
    const data = (await res.json()) as CategoryNode[]
    setCategories(data)
  }

  useEffect(() => {
    loadCategories()
  }, [])

  // Auto-slug (don’t override while editing existing slug manually)
  useEffect(() => {
    if (editing) return
    setSlug(slugify(title))
  }, [title, editing])

  const resetForm = () => {
    setEditing(null)
    setTitle('')
    setSlug('')
    setParentId(null)
    setImage('')
    setDescription('')
  }

  // Flatten categories for Parent dropdown (with indent)
  const flatCategories = useMemo(() => {
    const out: CategoryNode[] = []
    const walk = (nodes: CategoryNode[], depth = 0) => {
      nodes.forEach(n => {
        out.push({ ...n, title: `${'— '.repeat(depth)}${n.title}` })
        if (n.children?.length) walk(n.children, depth + 1)
      })
    }
    walk(categories)
    return out
  }, [categories])

  // Filtered tree
  const filteredTree = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return categories
    const match = (n: CategoryNode): boolean =>
      n.title.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q)
    const walk = (nodes: CategoryNode[]): CategoryNode[] =>
      nodes
        .map(n => {
          const kids = n.children ? walk(n.children) : []
          if (match(n) || kids.length) {
            return { ...n, children: kids }
          }
          return null
        })
        .filter(Boolean) as CategoryNode[]
    return walk(categories)
  }, [categories, filter])

  const onSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      title,
      slug,
      parentId,
      image: image || null,
      description: description || null,
    }
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      await loadCategories()
      resetForm()
    } else {
      const err = await res.json().catch(() => ({}))
      alert('Create failed: ' + (err?.error || res.statusText))
    }
  }

  const onSubmitUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    const payload = {
      id: editing.id,
      title,
      slug,
      image: image || null,
      description: description || null,
    }
    const res = await fetch('/api/categories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      await loadCategories()
      resetForm()
    } else {
      const err = await res.json().catch(() => ({}))
      alert('Update failed: ' + (err?.error || res.statusText))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category?')) return
    const res = await fetch('/api/categories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      await loadCategories()
    } else {
      const err = await res.json().catch(() => ({}))
      alert('Delete failed: ' + (err?.error || res.statusText))
    }
  }

  const startEdit = (cat: CategoryNode) => {
    setEditing(cat)
    setTitle(cat.title)
    setSlug(cat.slug)
    setParentId(null) // lock parent during edit (simpler/safer)
    setImage(cat.image || '')
    setDescription(cat.description || '')
  }

  const toggleOpen = (id: string) => setOpen(prev => ({ ...prev, [id]: !prev[id] }))

  const Tree = ({ nodes }: { nodes: CategoryNode[] }) => {
    if (!nodes?.length) return null
    return (
      <ul className="space-y-1">
        {nodes.map(n => {
          const hasKids = !!n.children?.length
          const isOpen = open[n.id] ?? true
          return (
            <li key={n.id}>
              <div className="group flex items-start gap-2 rounded-md px-2 py-1 hover:bg-slate-50">
                {hasKids ? (
                  <button
                    onClick={() => toggleOpen(n.id)}
                    className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded border text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    title={isOpen ? 'Collapse' : 'Expand'}
                  >
                    <span className="text-xs">{isOpen ? '−' : '+'}</span>
                  </button>
                ) : (
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded border border-transparent text-slate-300">•</span>
                )}

                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{n.title}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">/{n.slug}</span>
                    {n.image ? <span className="text-xs text-slate-500">🖼️</span> : null}
                  </div>
                  {n.description ? (
                    <p className="mt-0.5 text-sm leading-snug text-slate-700">{n.description}</p>
                  ) : null}

                  <div className="mt-1 flex gap-3">
                    <button
                      onClick={() => startEdit(n)}
                      className="text-sm font-medium text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(n.id)}
                      className="text-sm font-medium text-red-700 hover:underline focus:outline-none focus:ring-2 focus:ring-rose-500"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {hasKids && isOpen ? (
                <div className="ml-6 border-l border-slate-200 pl-4">
                  <Tree nodes={n.children!} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Manage Category Tree</h1>
          <p className="mt-1 text-slate-700">
            Create, edit, and organize categories. Fields include <span className="font-semibold">title</span>,{' '}
            <span className="font-semibold">slug</span>, <span className="font-semibold">parent</span>,{' '}
            <span className="font-semibold">image URL</span>, and <span className="font-semibold">description</span>.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-[minmax(0,420px),1fr]">
          {/* Left: Form Card */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {editing ? 'Edit Category' : 'Add Category'}
              </h2>
            </div>

            <form
              onSubmit={editing ? onSubmitUpdate : onSubmitCreate}
              className="px-5 py-4"
              autoComplete="off"
            >
              <div className="grid gap-4">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-900">Title</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    placeholder="e.g. Braking Systems"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-900">Slug</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    placeholder="braking-systems"
                    value={slug}
                    onChange={e => setSlug(e.target.value)}
                    required
                  />
                  <p className="mt-1 text-xs text-slate-600">Auto-generated from title; you can override if needed.</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-900">
                    Parent <span className="font-normal text-slate-600">(optional)</span>
                  </label>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:opacity-60"
                    value={parentId ?? ''}
                    onChange={e => setParentId(e.target.value || null)}
                    disabled={!!editing}
                  >
                    <option value="">(Top level)</option>
                    {flatCategories.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  {editing ? (
                    <p className="mt-1 text-xs text-slate-600">Parent locked while editing (to keep the tree stable).</p>
                  ) : null}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-900">Image URL</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    placeholder="https://cdn.shopify.com/s/files/.../image.jpg"
                    value={image}
                    onChange={e => setImage(e.target.value)}
                  />
                  {image ? (
                    <img
                      src={image}
                      alt="preview"
                      className="mt-2 h-28 w-full max-w-xs rounded-lg border border-slate-200 object-cover"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  ) : null}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-900">
                    Description <span className="font-normal text-slate-600">(optional)</span>
                  </label>
                  <textarea
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    rows={4}
                    placeholder="Short description for this category"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
                  <div className="mt-1 text-right text-xs text-slate-600">{description.length} chars</div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
                  >
                    {editing ? 'Update Category' : 'Add Category'}
                  </button>
                  {editing ? (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            </form>
          </section>

          {/* Right: Tree & Filter */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Category Tree</h2>
                <div className="w-64">
                  <label className="sr-only">Filter categories</label>
                  <input
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Filter by title or slug…"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-auto px-5 py-4">
              {filteredTree.length ? (
                <Tree nodes={filteredTree} />
              ) : (
                <p className="text-slate-700">No categories match your filter.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
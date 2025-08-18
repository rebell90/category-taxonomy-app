'use client'

import { useEffect, useState } from 'react'

type CategoryNode = {
  id: string
  title: string
  slug: string
  image?: string | null
  description?: string | null
  parentId: string | null
  children?: CategoryNode[]
}

export default function TreeViewerPage() {
  const [tree, setTree] = useState<CategoryNode[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(sessionStorage.getItem('cat_viewer_open') || '{}') } catch { return {} }
  })
  const [filter, setFilter] = useState('')

  useEffect(() => {
    sessionStorage.setItem('cat_viewer_open', JSON.stringify(open))
  }, [open])

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/categories', { cache: 'no-store' })
        const data = (await res.json()) as CategoryNode[]
        setTree(data)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const toggle = (id: string) => setOpen(p => ({ ...p, [id]: !p[id] }))

  const matches = (n: CategoryNode, q: string) =>
    n.title.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q)

  const filtered = (() => {
    const q = filter.trim().toLowerCase()
    if (!q) return tree
    const walk = (nodes: CategoryNode[]): CategoryNode[] =>
      nodes.map(n => {
        const kids = n.children ? walk(n.children) : []
        return (matches(n, q) || kids.length) ? { ...n, children: kids } : null
      }).filter(Boolean) as CategoryNode[]
    return walk(tree)
  })()

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
                    onClick={() => toggle(n.id)}
                    className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded border text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    title={isOpen ? 'Collapse' : 'Expand'}
                  >
                    <span className="text-xs">{isOpen ? '−' : '+'}</span>
                  </button>
                ) : (
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center text-slate-300">•</span>
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
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Category Tree (Read-only)</h1>
            <p className="text-slate-700">Live view of your current taxonomy.</p>
          </div>
          <div className="w-72">
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter by title or slug…"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
            />
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading ? <p className="text-slate-700">Loading…</p> :
            filtered.length ? <Tree nodes={filtered} /> :
            <p className="text-slate-700">No categories.</p>}
        </section>
      </div>
    </main>
  )
}
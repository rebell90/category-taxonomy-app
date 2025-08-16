import type { ReactNode } from 'react'
import Link from 'next/link'
import { SidebarNav } from './sidebar-nav'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 bg-slate-900 text-slate-100">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-xl font-bold tracking-tight">Catalog Tools</div>
          <div className="text-xs text-slate-300 mt-1">Admin utilities</div>
        </div>

        <SidebarNav />

        <div className="px-5 py-4 border-t border-slate-800 text-xs text-slate-300">
          <Link href="/" className="underline hover:text-white transition-colors">
            ← Back to app
          </Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
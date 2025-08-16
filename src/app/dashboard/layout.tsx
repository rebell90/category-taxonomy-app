import type { ReactNode } from 'react'
import Link from 'next/link'
import { SidebarNav } from './sidebar-nav'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r bg-white">
        <div className="px-5 py-4 border-b">
          <div className="text-lg font-bold">Catalog Tools</div>
          <div className="text-xs text-gray-500">Admin utilities</div>
        </div>
        <SidebarNav />
        <div className="px-5 py-4 border-t text-xs text-gray-500">
          <Link href="/" className="underline">← Back to app</Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1">{children}</main>
    </div>
  )
}
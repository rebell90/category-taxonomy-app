// app/dashboard/layout.tsx
'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { SidebarNav } from './sidebar-nav'
import { useSession, signOut } from 'next-auth/react'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { data: session } = useSession()

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-xl font-bold tracking-tight">Catalog Tools</div>
          <div className="text-xs text-slate-300 mt-1">Admin utilities</div>
        </div>

        <div className="flex-1">
          <SidebarNav />
        </div>

        {/* User info & Sign out at bottom */}
        <div className="border-t border-slate-800">
          {session?.user && (
            <div className="px-5 py-3 border-b border-slate-800">
              <div className="text-xs text-slate-400">Signed in as</div>
              <div className="text-sm text-slate-200 truncate mt-0.5">
                {session.user.email}
              </div>
            </div>
          )}
          
          <div className="px-5 py-4 space-y-2">
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full text-left text-sm text-slate-300 hover:text-white transition-colors underline"
            >
              Sign Out →
            </button>
            <Link 
              href="/" 
              className="block text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              ← Back to app
            </Link>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 p-8 dashboard">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
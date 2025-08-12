'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const tabs = [
    { href: '/dashboard/categories', label: 'Categories' },
    { href: '/dashboard/assign', label: 'Assign Products' },
  ]

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Taxonomy Dashboard</h1>
        <p className="text-sm text-gray-500">Manage your category tree and assign products.</p>
      </header>

      <nav className="flex gap-4 border-b mb-6">
        {tabs.map(t => {
          const active = pathname?.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`pb-2 -mb-px ${active ? 'border-b-2 border-blue-600 font-medium' : 'text-gray-600'}`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>

      {children}
    </main>
  )
}
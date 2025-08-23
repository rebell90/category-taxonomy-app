'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/ui'

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/audit', label: 'Product + Category View' },
  { href: '/dashboard/tree', label: 'View Category Tree' },
  { href: '/dashboard/categories', label: 'Manage Category Tree' },
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="py-3">
      <ul className="px-2 space-y-1">
        {links.map((link) => {
          const active =
            pathname === link.href ||
            (link.href !== '/dashboard' && pathname.startsWith(link.href))

          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-200 hover:bg-slate-800 hover:text-white'
                )}
              >
                {/* simple bullet accent */}
                <span
                  className={cn(
                    'h-2.5 w-2.5 rounded-full transition-colors',
                    active ? 'bg-emerald-400' : 'bg-slate-600 group-hover:bg-emerald-300'
                  )}
                  aria-hidden="true"
                />
                <span className="truncate">{link.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
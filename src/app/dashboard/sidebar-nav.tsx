'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/ui'

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/audit', label: 'Products ↔ Categories Audit' },
  { href: '/dashboard/assign', label: 'Assign Products to Categories' },
  { href: '/categories', label: 'Manage Category Tree' },
]

export function SidebarNav() {
  const pathname = usePathname()
  return (
    <nav className="py-3">
      <ul className="space-y-1 px-2">
        {links.map(link => {
          const active = pathname === link.href
            || (link.href !== '/dashboard' && pathname.startsWith(link.href))
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  'block rounded px-3 py-2 text-sm',
                  active ? 'bg-gray-100 font-medium text-gray-900'
                         : 'text-gray-700 hover:bg-gray-50'
                )}
              >
                {link.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
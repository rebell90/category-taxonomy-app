// src/app/layout.tsx
import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Category Taxonomy App',
  description: 'Admin + taxonomy tools',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Global header */}
        <header className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
            <Link href="/" className="font-semibold">Home</Link>
            <Link href="/dashboard" className="text-gray-700 hover:underline">Dashboard</Link>
            <Link href="/dashboard/categories" className="text-gray-700 hover:underline">Assign Categories</Link>
            <Link href="/dashboard/assign" className="text-gray-700 hover:underline">Assign Products</Link>
            <Link href="/dashboard/audit" className="text-gray-700 hover:underline">Master View</Link>
            <Link href="/dashboard/fitments" className="text-gray-700 hover:underline">Fitment Tags</Link>
            <Link href="/dashboard/tree" className="text-gray-700 hover:underline">Category Tree</Link>
          </div>
        </header>

        {/* Page content */}
        {children}
      </body>
    </html>
  )
}
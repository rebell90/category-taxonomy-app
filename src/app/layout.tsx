// src/app/layout.tsx
import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Category Taxonomy App',
  description: 'Admin + taxonomy tools',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* (Optional) Global top header – safe, valid JSX */}
        <header className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
            <a href="/" className="font-semibold">Home</a>
            <a href="/dashboard" className="text-gray-700 hover:underline">Dashboard</a>
            <a href="/categories" className="text-gray-700 hover:underline">Categories</a>
            <a href="/dashboard/assign" className="text-gray-700 hover:underline">Assign</a>
            <a href="/dashboard/audit" className="text-gray-700 hover:underline">Audit</a>
          </div>
        </header>

        {/* Page content */}
        {children}
      </body>
    </html>
  )
}
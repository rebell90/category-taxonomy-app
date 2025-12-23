// src/app/layout.tsx
import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Providers } from './providers'
import { Header } from './header'  // We'll create this next

export const metadata: Metadata = {
  title: 'Category Taxonomy App',
  description: 'Admin + taxonomy tools',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {/* Header is now INSIDE Providers so it can access auth session */}
          <Header />
          {/* Page content */}
          {children}
        </Providers>
      </body>
    </html>
  )
}
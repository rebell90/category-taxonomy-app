// src/app/header.tsx
'use client'

import { useSession, signOut } from 'next-auth/react'
import Link from 'next/link'

export function Header() {
  const { data: session } = useSession()

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        {/* Navigation Links */}
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold">Home</Link>
          
          {/* Only show these links if logged in */}
          {session && (
            <>
              <Link href="/dashboard" className="text-gray-700 hover:underline">Dashboard</Link>
              <Link href="/dashboard/categories" className="text-gray-700 hover:underline">Assign Categories</Link>
              <Link href="/dashboard/audit" className="text-gray-700 hover:underline">Product + Category View</Link>
              <Link href="/dashboard/fit-terms" className="text-gray-700 hover:underline">Fitment Terms</Link>
              <Link href="/dashboard/fitments-audit" className="text-gray-700 hover:underline">Fitment + Products</Link>
              <Link href="/dashboard/distributors" className="text-blue-600 underline">Distributor Import</Link>
            </>
          )}
        </div>

        {/* User Menu */}
        <div className="flex items-center gap-4">
          {session ? (
            <>
              <span className="text-sm text-gray-600">{session.user?.email}</span>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="px-4 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
              >
                Sign Out
              </button>
            </>
          ) : (
            <Link 
              href="/login"
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
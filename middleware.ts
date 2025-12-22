// middleware.ts (place this in your PROJECT ROOT, next to package.json)
import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    // Request is authenticated, allow it through
    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => {
        // User must be logged in to access these routes
        return !!token
      },
    },
    pages: {
      signIn: '/login',
    },
  }
)

// Protect these routes - CRITICAL!
export const config = {
  matcher: [
    '/dashboard/:path*',      // All dashboard pages
    '/api/admin/:path*',      // All admin API routes
    '/api/categories/:path*', // Category management
    '/api/product-categories/:path*', // Product-category links
    '/api/fit-terms/:path*',  // Fitment terms
  ],
}
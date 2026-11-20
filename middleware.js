// middleware.ts
import { auth } from './src/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isAuthenticated = !!req.auth
  const isLoginPage = req.nextUrl.pathname === '/login'
  
  if (!isAuthenticated && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  
  return NextResponse.next()
})

export const config = {
  // /api/mcp is intentionally NOT listed here — it uses bearer-token auth
  // handled inside its own route handler (src/app/api/mcp/route.ts).
  matcher: [
    '/dashboard/:path*',
    '/api/admin/:path*',
    '/api/categories/:path*',
    '/api/product-categories/:path*',
    '/api/fit-terms/:path*',
  ],
}
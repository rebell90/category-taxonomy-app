// src/middleware.ts
import { auth } from './auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const path = req.nextUrl.pathname
  const method = req.method
  
  // Allow public READ access to fit-terms (GET only)
  if (path.startsWith('/api/fit-terms') && method === 'GET') {
    return NextResponse.next()
  }
  
  // Allow public READ access to other public endpoints
  if (path.startsWith('/api/public/') && method === 'GET') {
    return NextResponse.next()
  }
  
  // Everything else requires authentication
  const isAuthenticated = !!req.auth
  const isLoginPage = path === '/login'
  
  if (!isAuthenticated && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  
  return NextResponse.next()
})

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/:path*',  // Protect ALL API routes (middleware will check method)
  ],
}
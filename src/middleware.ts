// src/middleware.ts
import { auth } from './auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isAuthenticated = !!req.auth
  const isLoginPage = req.nextUrl.pathname === '/login'
  
  console.log('🔒 Middleware running:', req.nextUrl.pathname)
  console.log('🔑 Authenticated:', isAuthenticated)
  
  if (!isAuthenticated && !isLoginPage) {
    console.log('❌ Redirecting to login')
    return NextResponse.redirect(new URL('/login', req.url))
  }
  
  return NextResponse.next()
})

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/admin/:path*',
    '/api/categories/:path*',
    '/api/product-categories/:path*',
    '/api/fit-terms/:path*',
  ],
}
// middleware.ts
export { default } from 'next-auth/middleware'

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/admin/:path*',
    '/api/categories/:path*',
    '/api/product-categories/:path*',
    '/api/fit-terms/:path*',
  ],
}
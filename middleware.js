import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || []
    const isAdmin = token?.email && adminEmails.includes(token.email)
    const isAdminRoute = req.nextUrl.pathname.startsWith('/admin')
    
    if (isAdminRoute && !isAdmin) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    
    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token
    },
  }
)

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/api/deposit/:path*', '/api/withdraw/:path*']
}

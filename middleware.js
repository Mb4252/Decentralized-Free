import { NextResponse } from 'next/server'

export function middleware(request) {
  // التحقق من وجود جلسة Firebase مخزنة في localStorage (يتم التحقق على العميل)
  // هذا middleware بسيط للصفحات المحمية
  const url = request.nextUrl.pathname
  
  // الصفحات المحمية
  const protectedPaths = ['/dashboard', '/admin']
  const isProtectedPath = protectedPaths.some(path => url.startsWith(path))
  
  // ملاحظة: التحقق الفعلي سيتم على العميل
  // هذا middleware يسمح بالمرور مؤقتاً
  if (isProtectedPath) {
    // يمكنك إضافة منطق إضافي هنا إذا أردت
    return NextResponse.next()
  }
  
  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*']
}

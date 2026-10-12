import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { DASHBOARD_HEADER } from '@/i18n/locales'

/**
 * Optimistic check only: no cookie → login. Pages, actions and route handlers still
 * verify the session themselves (lib/session.ts).
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set(DASHBOARD_HEADER, request.nextUrl.pathname.startsWith('/api/') ? '0' : '1')
    return NextResponse.next({ request: { headers: requestHeaders } })
  }
  const login = new URL('/login', request.url)
  login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: [
    '/home',
    '/automations/:path*',
    '/contacts/:path*',
    '/bio/:path*',
    '/settings/:path*',
    '/connect',
    '/api/contacts/:path*',
    '/api/meta/oauth/:path*',
  ],
}

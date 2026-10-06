import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Optimistic check only: no cookie → login. Pages, actions and route handlers still
 * verify the session themselves (lib/session.ts).
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next()
  const login = new URL('/login', request.url)
  login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: [
    '/home',
    '/automations/:path*',
    '/contacts/:path*',
    '/settings/:path*',
    '/connect',
    '/api/contacts/:path*',
    '/api/meta/oauth/:path*',
  ],
}

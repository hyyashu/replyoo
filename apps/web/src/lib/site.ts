import { headers } from 'next/headers'

/**
 * Public origin of this request, so canonicals, sitemap and structured data follow whatever domain serves the site.
 * Behind the proxy the original host arrives in `x-forwarded-host`. `APP_URL` is only the fallback for when there is no
 * request to read, and it is never needed at build time.
 */
export async function getSiteUrl(): Promise<string> {
  const requestHeaders = await headers()
  const host = (requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'))?.split(',')[0]?.trim()
  if (host) {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
    const proto = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? (isLocal ? 'http' : 'https')
    return `${proto}://${host}`
  }
  return (process.env.APP_URL ?? 'http://localhost:3217').replace(/\/$/, '')
}

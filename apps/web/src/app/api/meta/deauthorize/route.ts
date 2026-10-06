import { db } from '@/lib/db'
import { deauthorizeMetaUser, signedRequestFrom } from '@/lib/meta-callbacks'

/** Meta "Deauthorize callback URL" (spec §5.3). No session: the verified signed_request identifies the Meta user. */
export async function POST(request: Request) {
  const signed = await signedRequestFrom(request)
  if (!signed) return new Response('Invalid signed_request', { status: 400 })
  await deauthorizeMetaUser(db(), signed.platform, signed.userId)
  return new Response(null, { status: 200 })
}

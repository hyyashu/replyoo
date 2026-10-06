import { db } from '@/lib/db'
import { appUrl } from '@/lib/env'
import { deleteMetaUserData, signedRequestFrom } from '@/lib/meta-callbacks'

/** Meta "Data deletion request URL" (spec §5.3, §7). Meta shows the person the URL and code we return. */
export async function POST(request: Request) {
  const signed = await signedRequestFrom(request)
  if (!signed) return new Response('Invalid signed_request', { status: 400 })
  const { confirmationCode } = await deleteMetaUserData(db(), signed.platform, signed.userId)
  return Response.json({
    url: appUrl(`/data-deletion/status?code=${confirmationCode}`),
    confirmation_code: confirmationCode,
  })
}

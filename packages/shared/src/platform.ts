import { z } from 'zod'

export const PlatformSchema = z.enum(['instagram', 'facebook'])
export type Platform = z.infer<typeof PlatformSchema>

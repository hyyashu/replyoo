import { z } from 'zod'

export const PLATFORMS = ['instagram', 'facebook'] as const
export const PlatformSchema = z.enum(PLATFORMS)
export type Platform = (typeof PLATFORMS)[number]

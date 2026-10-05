import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  INSTAGRAM_APP_SECRET: z.string().min(1),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  META_GRAPH_VERSION: z.string().default('v24.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  OUTBOUND_RATE_PER_SECOND: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return EnvSchema.parse(source)
}

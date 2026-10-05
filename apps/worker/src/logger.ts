import { pino } from 'pino'

export type { Logger } from 'pino'

export function createLogger(level: string) {
  return pino({ level, base: { service: 'worker' } })
}

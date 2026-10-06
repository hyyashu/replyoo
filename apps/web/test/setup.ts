import { RecordingMailer } from '@replyooo/email/testing'
import { afterAll, inject } from 'vitest'
import { setMailer } from '@/lib/email'
import { closeDb } from '@/lib/db'

// Runs before each test file is imported, so env() and db() see these values.
process.env.DATABASE_URL = inject('databaseUrl')
process.env.APP_URL = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0000'
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.META_APP_ID = 'fb-app'
process.env.META_APP_SECRET = 'fb-secret'
process.env.INSTAGRAM_APP_ID = 'ig-app'
process.env.INSTAGRAM_APP_SECRET = 'ig-secret'
process.env.META_GRAPH_VERSION = 'v24.0'
process.env.EMAIL_PROVIDER = 'log'
// No test sends real email; files that assert on email install their own RecordingMailer.
setMailer(new RecordingMailer())

afterAll(closeDb)

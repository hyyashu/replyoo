import { createServer, type AddressInfo } from 'node:net'
import { SMTPServer } from 'smtp-server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EmailError, createMailer, smtpMailer } from '../src/mailer'

interface Received {
  from: string
  to: string[]
  user: string | undefined
  raw: string
}

const received: Received[] = []
const server = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  onAuth(auth, _session, callback) {
    if (auth.username === 'mailer' && auth.password === 'secret') callback(null, { user: auth.username })
    else callback(new Error('Invalid username or password'))
  },
  onData(stream, session, callback) {
    let raw = ''
    stream.on('data', (chunk: Buffer) => (raw += chunk.toString()))
    stream.on('end', () => {
      received.push({
        from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
        to: session.envelope.rcptTo.map((r) => r.address),
        user: typeof session.user === 'string' ? session.user : undefined,
        raw,
      })
      callback()
    })
  },
})
let port = 0

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
afterEach(() => {
  received.length = 0
  vi.unstubAllGlobals()
})

const message = { to: 'sam@example.com', subject: 'Hello from SMTP', html: '<p>Hi</p>', text: 'Hi there' }

describe('smtpMailer', () => {
  it('delivers through an authenticated SMTP server', async () => {
    await smtpMailer('hi@replyooo.test', { host: '127.0.0.1', port, secure: false, user: 'mailer', pass: 'secret' }).send(message)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ from: 'hi@replyooo.test', to: ['sam@example.com'], user: 'mailer' })
    expect(received[0]?.raw).toContain('Subject: Hello from SMTP')
    expect(received[0]?.raw).toContain('Hi there')
  })

  it('wraps connection failures in an EmailError', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', () => resolve()))
    const deadPort = (closed.address() as AddressInfo).port
    await new Promise<void>((resolve) => closed.close(() => resolve()))

    const error = await smtpMailer('hi@replyooo.test', { host: '127.0.0.1', port: deadPort, secure: false })
      .send(message)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmailError)
    expect((error as Error).message).toMatch(/^SMTP send failed: /)
  })

  it('falls back to SMTP when Resend is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'unavailable' }, { status: 503 })))
    const mailer = createMailer({
      from: 'hi@replyooo.test',
      providers: ['resend', 'smtp'],
      resend: { apiKey: 're_1' },
      smtp: { host: '127.0.0.1', port, secure: false },
    })
    await mailer.send(message)
    expect(received.map((r) => r.to)).toEqual([['sam@example.com']])
  })
})

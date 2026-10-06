import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailError, createMailer, failoverMailer, logMailer, resendMailer } from '../src/mailer'
import { RecordingMailer } from '../src/testing'

const message = { to: 'sam@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }

function stubFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return respond()
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('resendMailer', () => {
  it('posts the message to the Resend API with the key', async () => {
    const calls = stubFetch(() => Response.json({ id: 'email_1' }))
    await resendMailer('Replyooo <hi@replyooo.test>', 're_123').send(message)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.resend.com/emails')
    expect(calls[0]?.init.method).toBe('POST')
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer re_123')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      from: 'Replyooo <hi@replyooo.test>',
      to: ['sam@example.com'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
  })

  it('turns a rejection into an EmailError with Resend’s message', async () => {
    stubFetch(() => Response.json({ name: 'validation_error', message: 'Invalid `from` field' }, { status: 422 }))
    const error = await resendMailer('bad', 're_123').send(message).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmailError)
    expect((error as Error).message).toBe('Resend rejected the email (422): Invalid `from` field')
  })
})

describe('failoverMailer', () => {
  it('uses the next provider when one fails, and reports every failure when all do', async () => {
    const down = new RecordingMailer()
    down.failWith = new Error('resend down')
    const backup = new RecordingMailer()
    await failoverMailer([down, backup]).send(message)
    expect(backup.sent).toEqual([message])

    backup.failWith = new Error('smtp down')
    await expect(failoverMailer([down, backup]).send(message)).rejects.toThrow(
      'Every email provider failed: resend down | smtp down',
    )
  })
})

describe('logMailer and createMailer', () => {
  it('prints the recipient, subject and text', async () => {
    const lines: string[] = []
    await logMailer((line) => lines.push(line)).send(message)
    expect(lines).toEqual(['[email] to=sam@example.com subject="Hello"\nHi'])
  })

  it('builds a single provider or a failover chain from config', async () => {
    const lines: string[] = []
    await createMailer({ from: 'x', providers: ['log'] }, { print: (line) => lines.push(line) }).send(message)
    expect(lines).toHaveLength(1)

    stubFetch(() => Response.json({ message: 'down' }, { status: 500 }))
    await createMailer(
      { from: 'x', providers: ['resend', 'log'], resend: { apiKey: 're_1' } },
      { print: (line) => lines.push(line) },
    ).send(message)
    expect(lines).toHaveLength(2)
  })
})

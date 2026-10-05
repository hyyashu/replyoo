import { describe, expect, it } from 'vitest'
import { toGraphMessage } from '../src'

describe('toGraphMessage', () => {
  it('sends plain text', () => {
    expect(toGraphMessage({ kind: 'text', text: 'Hi Priya' })).toEqual({ text: 'Hi Priya' })
    expect(toGraphMessage({ kind: 'text', text: 'Hi', buttons: [] })).toEqual({ text: 'Hi' })
  })

  it('uses a button template for buttons', () => {
    expect(
      toGraphMessage({
        kind: 'text',
        text: 'Tap below',
        buttons: [
          { type: 'postback', label: 'Send it', payload: 'r:run:s1:b1' },
          { type: 'url', label: 'Shop', url: 'https://shop.example.com' },
        ],
      }),
    ).toEqual({
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: 'Tap below',
          buttons: [
            { type: 'postback', title: 'Send it', payload: 'r:run:s1:b1' },
            { type: 'web_url', title: 'Shop', url: 'https://shop.example.com' },
          ],
        },
      },
    })
  })

  it('truncates rendered text to Meta limits', () => {
    const plain = toGraphMessage({ kind: 'text', text: 'a'.repeat(1200) }) as { text: string }
    expect(plain.text).toHaveLength(1000)
    expect(plain.text.endsWith('…')).toBe(true)

    const withButtons = toGraphMessage({
      kind: 'text',
      text: 'b'.repeat(700),
      buttons: [{ type: 'postback', label: 'Go', payload: 'p' }],
    }) as { attachment: { payload: { text: string } } }
    expect(withButtons.attachment.payload.text).toHaveLength(640)
  })

  it('sends images as attachments', () => {
    expect(toGraphMessage({ kind: 'image', url: 'https://cdn.example.com/a.jpg' })).toEqual({
      attachment: { type: 'image', payload: { url: 'https://cdn.example.com/a.jpg' } },
    })
  })
})

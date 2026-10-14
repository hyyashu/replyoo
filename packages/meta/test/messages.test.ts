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

  it('sends a carousel as a generic template with one link button per card', () => {
    expect(
      toGraphMessage({
        kind: 'carousel',
        cards: [
          { title: 'Mug', button: { label: 'Buy', url: 'https://shop.example.com/mug' } },
          {
            title: 'Cap',
            subtitle: '$19',
            imageUrl: 'https://cdn.example.com/cap.jpg',
            button: { label: 'See it', url: 'https://shop.example.com/cap' },
          },
        ],
      }),
    ).toEqual({
      attachment: {
        type: 'template',
        payload: {
          template_type: 'generic',
          elements: [
            { title: 'Mug', buttons: [{ type: 'web_url', title: 'Buy', url: 'https://shop.example.com/mug' }] },
            {
              title: 'Cap',
              subtitle: '$19',
              image_url: 'https://cdn.example.com/cap.jpg',
              buttons: [{ type: 'web_url', title: 'See it', url: 'https://shop.example.com/cap' }],
            },
          ],
        },
      },
    })
  })

  it('truncates card text to 80 characters and never sends more than ten cards', () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({
      title: 't'.repeat(100),
      subtitle: 's'.repeat(100),
      button: { label: 'Buy', url: `https://shop.example.com/${i}` },
    }))
    const message = toGraphMessage({ kind: 'carousel', cards }) as {
      attachment: { payload: { elements: { title: string; subtitle: string }[] } }
    }
    const { elements } = message.attachment.payload
    expect(elements).toHaveLength(10)
    expect(elements[0]!.title).toHaveLength(80)
    expect(elements[0]!.title.endsWith('…')).toBe(true)
    expect(elements[0]!.subtitle).toHaveLength(80)
  })
})

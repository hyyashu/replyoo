import { ImageResponse } from 'next/og'

export const ogSize = { width: 1200, height: 630 }

const INK = '#151310'
const SAND = '#f5f1ea'
const LIME = '#d8f25a'
const BRAND = '#ff4f1f'

function Wordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', width: 56, height: 56, borderRadius: 16, background: INK, alignItems: 'center', justifyContent: 'center' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={LIME} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
          <path d="m10 15-3-3 3-3" />
          <path d="M7 12h8a2 2 0 0 1 2 2v1" />
        </svg>
      </div>
      <div style={{ display: 'flex', marginLeft: 16, fontSize: 40, letterSpacing: -1.5, color: INK }}>replyooo</div>
    </div>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', background: SAND, padding: 72 }}>
      {children}
      <div style={{ display: 'flex', position: 'absolute', right: 0, bottom: 0, width: 360, height: 24, background: BRAND }} />
    </div>
  )
}

function respond(node: React.ReactElement) {
  return new ImageResponse(node, ogSize)
}

export function brandImage() {
  return respond(
    <Frame>
      <Wordmark />
      <div style={{ display: 'flex', flexDirection: 'column', fontSize: 96, lineHeight: 1.05, letterSpacing: -4, color: INK }}>
        <div style={{ display: 'flex' }}>Turn every comment</div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ marginRight: 28 }}>into a</span>
          <span style={{ display: 'flex', background: LIME, borderRadius: 24, padding: '0 24px' }}>customer.</span>
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 32, color: '#5f584f' }}>Instagram & Facebook DM automation for creators</div>
    </Frame>,
  )
}

/** Fits the name on one to two lines: long names get a smaller size. */
function nameSize(name: string) {
  if (name.length <= 18) return 104
  if (name.length <= 36) return 76
  return 56
}

export function bioImage(displayName: string, bio: string) {
  const name = displayName.trim()
  if (!name) return brandImage()
  const blurb = bio.replace(/\s+/g, ' ').trim()
  const initial = (name[0] ?? '?').toUpperCase()
  return respond(
    <Frame>
      <Wordmark />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', width: 160, height: 160, borderRadius: 80, background: LIME, color: INK, fontSize: 80, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {initial}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 48, minWidth: 0 }}>
          <div style={{ display: 'block', fontSize: nameSize(name), lineHeight: 1.05, letterSpacing: -3, color: INK, lineClamp: 2 }}>{name}</div>
          {blurb && <div style={{ display: 'block', marginTop: 20, fontSize: 34, lineHeight: 1.3, color: '#5f584f', lineClamp: 3 }}>{blurb}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 28, color: '#6f675c' }}>Links by Replyooo</div>
    </Frame>,
  )
}

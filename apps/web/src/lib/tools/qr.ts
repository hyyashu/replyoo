import { encode } from 'uqr'

/**
 * A QR code as a standalone SVG: one path for the dark modules on a white background, with the 4-module quiet zone
 * the QR spec asks for. Error correction M survives some print smudges without making short links too dense.
 */
export function qrSvg(text: string): string {
  const { size, data } = encode(text, { ecc: 'M', border: 4 })
  let path = ''
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`
    }),
  )
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  )
}

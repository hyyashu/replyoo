/** User agents that are not a person opening a link: crawlers, link-preview fetchers and scripts. A missing user agent counts as one. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|headless|monitor/i.test(userAgent)
}

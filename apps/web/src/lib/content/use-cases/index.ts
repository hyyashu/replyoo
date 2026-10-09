import { sendLeadMagnetInstagram } from './send-lead-magnet-instagram'
import { sellProductsFromInstagramComments } from './sell-products-from-instagram-comments'
import { growFollowersWithGiveaways } from './grow-followers-with-giveaways'
import { bookCallsFromInstagramDms } from './book-calls-from-instagram-dms'
import type { MarketingPage } from '@/lib/content/types'

export const USE_CASE_PAGES: MarketingPage[] = [
  sendLeadMagnetInstagram,
  sellProductsFromInstagramComments,
  growFollowersWithGiveaways,
  bookCallsFromInstagramDms,
]

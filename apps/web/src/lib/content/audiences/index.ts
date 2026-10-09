import { coaches } from './coaches'
import { onlineShops } from './online-shops'
import { fitnessCreators } from './fitness-creators'
import { photographersAndFreelancers } from './photographers-and-freelancers'
import type { MarketingPage } from '@/lib/content/types'

export const AUDIENCE_PAGES: MarketingPage[] = [
  coaches,
  onlineShops,
  fitnessCreators,
  photographersAndFreelancers,
]

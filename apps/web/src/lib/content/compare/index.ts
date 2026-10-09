import type { ComparisonPage } from '@/lib/content/types'
import { replyoooVsCreatorflow } from './replyooo-vs-creatorflow'
import { replyoooVsInstantdm } from './replyooo-vs-instantdm'
import { replyoooVsManychat } from './replyooo-vs-manychat'
import { replyoooVsReplyrush } from './replyooo-vs-replyrush'

export const COMPARE_PAGES: ComparisonPage[] = [replyoooVsManychat, replyoooVsCreatorflow, replyoooVsInstantdm, replyoooVsReplyrush]

export const getComparePage = (slug: string) => COMPARE_PAGES.find((page) => page.slug === slug)

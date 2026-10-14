export interface EngagementInput {
  followers: number
  posts: { likes: number; comments: number; saves?: number; shares?: number }[]
}

export interface EngagementResult {
  /** Average interactions per post divided by followers, as a fraction (0.034 = 3.4%). */
  rate: number
  averageInteractions: number
}

const count = (n: number | undefined) => (Number.isFinite(n) && n! > 0 ? n! : 0)

/** Engagement rate by followers: (likes + comments + saves + shares) per post, averaged, over followers. */
export function engagementRate({ followers, posts }: EngagementInput): EngagementResult | null {
  if (!(followers > 0) || posts.length === 0) return null
  const total = posts.reduce((sum, p) => sum + count(p.likes) + count(p.comments) + count(p.saves) + count(p.shares), 0)
  const averageInteractions = total / posts.length
  return { rate: averageInteractions / followers, averageInteractions }
}

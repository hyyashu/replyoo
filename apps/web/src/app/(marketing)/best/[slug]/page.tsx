import { BestPageView, bestMetadata, bestStaticParams } from '@/components/best-page'

type Props = { params: Promise<{ slug: string }> }

export const generateStaticParams = bestStaticParams
export const generateMetadata = ({ params }: Props) => bestMetadata(params)

export default function Page({ params }: Props) {
  return <BestPageView params={params} />
}

import { ComparePage, compareMetadata, compareStaticParams } from '@/components/compare-page'

type Props = { params: Promise<{ slug: string }> }

export const generateStaticParams = () => compareStaticParams('compare')
export const generateMetadata = ({ params }: Props) => compareMetadata('compare', params)

export default function Page({ params }: Props) {
  return <ComparePage params={params} />
}

import { AlternativesPageView, compareMetadata, compareStaticParams } from '@/components/compare-page'

type Props = { params: Promise<{ slug: string }> }

export const generateStaticParams = () => compareStaticParams('alternatives')
export const generateMetadata = ({ params }: Props) => compareMetadata('alternatives', params)

export default function Page({ params }: Props) {
  return <AlternativesPageView params={params} />
}

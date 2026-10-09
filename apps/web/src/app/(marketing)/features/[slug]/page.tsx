import { SectionPage, sectionMetadata, sectionStaticParams } from '@/components/section-page'

type Props = { params: Promise<{ slug: string }> }

export const generateStaticParams = () => sectionStaticParams('features')
export const generateMetadata = ({ params }: Props) => sectionMetadata('features', params)

export default function Page({ params }: Props) {
  return <SectionPage section="features" params={params} />
}

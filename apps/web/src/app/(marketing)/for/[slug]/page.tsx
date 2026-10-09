import { SectionPage, sectionMetadata, sectionStaticParams } from '@/components/section-page'

type Props = { params: Promise<{ slug: string }> }

export const generateStaticParams = () => sectionStaticParams('for')
export const generateMetadata = ({ params }: Props) => sectionMetadata('for', params)

export default function Page({ params }: Props) {
  return <SectionPage section="for" params={params} />
}

import { SectionPage, sectionMetadata, sectionStaticParams } from '@/components/section-page'

type Props = { params: Promise<{ slug: string }> }

export const generateStaticParams = () => sectionStaticParams('use-cases')
export const generateMetadata = ({ params }: Props) => sectionMetadata('use-cases', params)

export default function Page({ params }: Props) {
  return <SectionPage section="use-cases" params={params} />
}

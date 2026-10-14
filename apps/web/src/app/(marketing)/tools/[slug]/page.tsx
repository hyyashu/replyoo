import { ToolPageView, toolMetadata, toolStaticParams } from '@/components/tool-page'

type Props = { params: Promise<{ slug: string }> }

export const generateStaticParams = toolStaticParams
export const generateMetadata = ({ params }: Props) => toolMetadata(params)

export default function Page({ params }: Props) {
  return <ToolPageView params={params} />
}

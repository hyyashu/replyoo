import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@replyooo/shared', '@replyooo/engine', '@replyooo/db', '@replyooo/meta'],
}

export default config

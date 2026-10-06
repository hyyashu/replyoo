import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@replyooo/shared', '@replyooo/engine', '@replyooo/db', '@replyooo/meta', '@replyooo/email'],
  // nodemailer is CommonJS with optional native deps; load it from node_modules instead of bundling it.
  serverExternalPackages: ['nodemailer'],
}

export default config

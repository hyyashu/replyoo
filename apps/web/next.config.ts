import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const config: NextConfig = {
  transpilePackages: ['@replyooo/shared', '@replyooo/engine', '@replyooo/db', '@replyooo/meta', '@replyooo/email'],
  // nodemailer is CommonJS with optional native deps; load it from node_modules instead of bundling it.
  serverExternalPackages: ['nodemailer'],
}

export default createNextIntlPlugin('./src/i18n/request.ts')(config)

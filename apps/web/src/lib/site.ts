/** Public origin for sitemap/robots. Read straight from the environment so `next build` doesn't need the full app env. */
export const siteUrl = (process.env.APP_URL ?? 'http://localhost:3217').replace(/\/$/, '')

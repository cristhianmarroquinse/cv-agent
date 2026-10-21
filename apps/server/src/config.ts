import path from 'node:path'

const root = path.resolve(import.meta.dir, '../../..')

export const config = {
  port: Number(process.env.PORT ?? 3001),
  openRouterKey: process.env.OPENROUTER_API_KEY ?? '',
  openRouterBase: 'https://openrouter.ai/api/v1',
  siteUrl: process.env.SITE_URL ?? 'http://localhost:5173',
  siteTitle: 'Cristhian Marroquin CV agent',
  rootDir: root,
  cacheDir: path.join(root, '.cache'),
  webDist: path.join(root, 'apps/web/dist'),
  publicDir: path.join(root, 'apps/server/public'),
  maxSteps: 4,
  maxMessages: 20,
  maxMessageChars: 2000,
  maxJobDescriptionChars: 8000,
  maxRequirements: 8,
  retrievalTopK: 5,
  rateLimit: { perIp: 80, windowMs: 10 * 60 * 1000, globalPerDay: 1200 },
  responseCacheTtlMs: 6 * 60 * 60 * 1000,
  retrievalCacheTtlMs: 60 * 60 * 1000,
}

if (!config.openRouterKey) {
  console.warn('[config] OPENROUTER_API_KEY is not set: chat requests will fail')
}

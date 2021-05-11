import { ServerPlugin } from '.'

export const envPublicPath = '/toyserver/env'

export const envPlugin: ServerPlugin = ({ app, config }) => {
  // configMode = mode of the .env{.mode} file that was loaded
  const configMode = config.mode || 'development'
  // resolvedMode = potentially overwritten by NODE_ENV inside the .env
  // (which is set as TOYSERVER_ENV to avoid system default NODE_ENV)
  const resolvedMode = process.env.TOYSERVER_ENV || configMode
  const env = JSON.stringify({
    ...config.env,
    BASE_URL: '/',
    MODE: configMode,
    DEV: resolvedMode !== 'production',
    PROD: resolvedMode === 'production'
  })

  app.use((ctx, next) => {
    if (ctx.path === envPublicPath) {
      ctx.type = 'js'
      ctx.body = `export default ${env}`
      return
    }
    return next()
  })
}

import path from 'path'
import { ServerPlugin } from '.'

export const seenUrls = new Set()

export const serveStaticPlugin: ServerPlugin = ({ app, root }) => {
  app.use(require('koa-etag')())
  app.use(require('koa-static')(root))
  app.use(require('koa-static')(path.join(root, 'public')))
}

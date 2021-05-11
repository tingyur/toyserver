import path from 'path'
import fs from 'fs-extra'
import http, { RequestListener, Server } from 'http'
import { ServerOptions } from 'https'
import Koa, { DefaultState, DefaultContext } from 'koa'
import chokidar from 'chokidar'
import { createResolver, InternalResolver } from '../resolver'
import { SourceMap } from './serverPluginSourceMap'
import { HMRWatcher } from './serverPluginHmr'
import { moduleRewritePlugin } from './serverPluginModuleRewrite'
import { serveStaticPlugin } from './serverPluginServeStatic'
import { ServerConfig } from '../config'
import { createCertificate } from '../utils/createCertificate'
import { cachedRead } from '../utils'

const server = http.createServer()
server.listen()
export interface ServerPluginContext {
  root: string
  app: Koa<State, Context>
  server: Server
  watcher: HMRWatcher
  resolver: InternalResolver
  config: ServerConfig & { __path?: string }
  port: number
}

export type ServerPlugin = (ctx: ServerPluginContext) => void

export interface State extends DefaultState {}

export type Context = DefaultContext &
  ServerPluginContext & {
    read: (filePath: string) => Promise<Buffer | string>
    map?: SourceMap | null
  }

export function createServer(config: ServerConfig): Server {
  const app = new Koa<State, Context>()
  const { root = process.cwd(), resolvers = [], alias = {} } = config
  const server = resolveServer(config, app.callback())
  const watcher = chokidar.watch(root, {
    ignored: [/node_modules/, /\.git/],
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 10
    }
  }) as HMRWatcher
  const resolver = createResolver(root, resolvers, alias)
  const context: ServerPluginContext = {
    root,
    app,
    server,
    watcher,
    resolver,
    config,
    // port is exposed on the context for hmr client connection
    // in case the files are served under a different port
    port: config.port || 3000
  }

  // attach server context to koa context
  app.use((ctx, next) => {
    Object.assign(ctx, context)
    ctx.read = cachedRead.bind(null, ctx)
    return next()
  })

  const resolvedPlugins = [moduleRewritePlugin, serveStaticPlugin]
  resolvedPlugins.forEach((m) => m && m(context))

  const listen = server.listen.bind(server)
  server.listen = (async (port: number, ...args: any[]) => {
    const listener = listen(port, ...args)
    context.port = server.address().port
    return listener
  }) as any

  return server
}

function resolveServer(
  { https = false, httpsOptions = {}, proxy }: ServerConfig,
  requestListener: RequestListener
) {
  if (https) {
    if (proxy) {
      return require('https').createServer(
        resolveHttpsConfig(httpsOptions),
        requestListener
      )
    } else {
      return require('http2').createServer(
        {
          ...resolveHttpsConfig(httpsOptions),
          allowHTTP1: true
        },
        requestListener
      )
    }
  } else {
    return require('http').createServer(requestListener)
  }
}

function resolveHttpsConfig(httpsOption: ServerOptions) {
  const { ca, cert, key, pfx } = httpsOption
  Object.assign(httpsOption, {
    ca: readFileIfExists(ca),
    cert: readFileIfExists(cert),
    key: readFileIfExists(key),
    pfx: readFileIfExists(pfx)
  })
  if (!httpsOption.key || !httpsOption.cert) {
    httpsOption.cert = httpsOption.key = createCertificate()
  }
  return httpsOption
}

function readFileIfExists(value?: string | Buffer | any) {
  if (value && !Buffer.isBuffer(value)) {
    try {
      return fs.readFileSync(path.resolve(value as string))
    } catch (e) {
      return value
    }
  }
  return value
}

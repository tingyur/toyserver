import path from 'path'
import fs from 'fs-extra'
import chalk from 'chalk'
import dotenv, { DotenvParseOutput } from 'dotenv'
import dotenvExpand from 'dotenv-expand'
import { ServerOptions } from 'https'
import { Resolver } from './resolver'
import { ProxiesOptions } from './server/serverPluginProxy'
import { lookupFile } from './utils'

export interface SharedConfig {
  /**
   * Project root directory, can be an absolute path, or a path relative from
   * the location of the config file itself.
   * @default process.cwd()
   */
  root?: string
  /**
   * Import alias. The entries can either be exact request -> request mappings
   * (exact, no wildcard syntax), or request path -> fs directory mappings.
   * When using directory mappings, the key **must start and end with a slash**.
   *
   * Example `toyserver.config.js`:
   * ``` js
   * module.exports = {
   *   alias: {
   *     // alias package names
   *     'react': '@pika/react',
   *     'react-dom': '@pika/react-dom'
   *
   *     // alias a path to a fs directory
   *     // the key must start and end with a slash
   *     '/@foo/': path.resolve(__dirname, 'some-special-dir')
   *   }
   * }
   * ```
   */
  alias?: Record<string, string>
  /**
   * Resolvers to map dev server public path requests to/from file system paths,
   * and optionally map module ids to public path requests.
   */
  resolvers?: Resolver[]
  /**
   * Environment mode
   */
  mode?: string
  /**
   * Environment variables parsed from .env files
   * only ones starting with TOYSERVER_ are exposed on `import.meta.env`
   * @internal
   */
  env?: DotenvParseOutput
}

export interface ServerConfig extends SharedConfig {
  hostname?: string
  port?: number
  open?: boolean
  https?: boolean
  httpsOptions?: ServerOptions
  proxy?: Record<string, string | ProxiesOptions>
}

export interface UserConfig extends ServerConfig {
  plugins?: Plugin[]
  eject?: {
    path?: string
  }
  dryrun?: boolean
}

export interface Plugin extends Pick<UserConfig, 'alias' | 'resolvers'> {}

export interface ResolvedConfig extends UserConfig {
  __path?: string
}

const debug = require('debug')('toyserver:config')

export async function resolveConfig(
  mode: string,
  configPath?: string
): Promise<ResolvedConfig | undefined> {
  const start = Date.now()
  const cwd = process.cwd()
  let config: ResolvedConfig | undefined
  let resolvedPath: string | undefined
  if (configPath) {
    resolvedPath = path.resolve(cwd, configPath)
  } else {
    const jsConfigPath = path.resolve(cwd, 'toyserver.config.js')
    if (fs.existsSync(jsConfigPath)) {
      resolvedPath = jsConfigPath
    } else {
      // TODO support ts config file
    }
  }

  if (!resolvedPath) {
    // load environment variables
    return {
      env: loadEnv(mode, cwd)
    }
  }

  try {
    try {
      config = require(resolvedPath)
    } catch (e) {
      if (
        !/Cannot use import statement|Unexpected token 'export'/.test(e.message)
      ) {
        throw e
      }
    }

    if (!config) {
      throw new Error(`the config file not found`)
    }

    // normalize config root to absolute
    if (config.root && !path.isAbsolute(config.root)) {
      config.root = path.resolve(path.dirname(resolvedPath), config.root)
    }

    // resolve plugins
    if (config.plugins) {
      for (const plugin of config.plugins) {
        config = resolvePlugin(config, plugin)
      }
    }

    config.env = {
      ...config.env,
      ...loadEnv(mode, config.root || cwd)
    }
    debug(`config resolved in ${Date.now() - start}ms`)

    config.__path = resolvedPath

    return config
  } catch (e) {
    console.error(
      chalk.red(`[vite] failed to load config from ${resolvedPath}:`)
    )
    console.error(e)
    process.exit(1)
  }
}

function resolvePlugin(config: UserConfig, plugin: Plugin): UserConfig {
  return {
    ...config,
    ...plugin,
    alias: {
      ...plugin.alias,
      ...config.alias
    },
    resolvers: [...(config.resolvers || []), ...(plugin.resolvers || [])]
  }
}

function loadEnv(mode: string, root: string): Record<string, string> {
  if (mode === 'local') {
    throw new Error(
      `"local" cannot be used as a mode name because it conflicts with ` +
        `the .local postfix for .env files.`
    )
  }

  debug(`env mode: ${mode}`)

  const nodeEnv = process.env
  const clientEnv: Record<string, string> = {}
  const envFiles = [
    /** mode local file */ `.env.${mode}.local`,
    /** mode file */ `.env.${mode}`,
    /** local file */ `.env.local`,
    /** default file */ `.env`
  ]

  for (const file of envFiles) {
    const path = lookupFile(root, [file], true)
    if (path) {
      const result = dotenv.config({
        debug: !!process.env.DEBUG || undefined,
        path
      })
      if (result.error) {
        throw result.error
      }
      dotenvExpand(result)
      for (const key in result.parsed) {
        const value = (nodeEnv[key] = result.parsed![key])
        // only keys that start with TOYSERVER_ are exposed.
        if (key.startsWith(`TOYSERVER_`)) {
          clientEnv[key] = value
        }
        // set NODE_ENV under a different key so that we know this is set from
        // toyserver-loaded .env files. Some users may have default NODE_ENV set in
        // their system.
        if (key === 'NODE_ENV') {
          nodeEnv.TOYSERVER_ENV = value
        }
      }
    }
  }

  debug(`env: %O`, clientEnv)
  return clientEnv
}

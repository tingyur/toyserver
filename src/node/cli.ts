const start = Date.now()
const argv = require('minimist')(process.argv.slice(2))

if (argv.debug) {
  process.env.DEBUG = `toyserver:` + (argv.debug === true ? '*' : argv.debug)
  try {
    require('source-map-support').install()
  } catch (e) {}
}

import os from 'os'
import path from 'path'
import chalk from 'chalk'
import { UserConfig, resolveConfig } from './config'

const command = argv._[0]
const defaultMode = command === 'build' ? 'production' : 'development'

function logHelp() {
  console.log(`
Usage: toyserver [command] [args] [--options]

Commands:
  toyserver                       Start server in current directory.
  toyserver serve [root=cwd]      Start server in target directory.
  toyserver build [root=cwd]      Build target directory.

Options:
  --help, -h                 [boolean] show help
  --version, -v              [boolean] show version
  --config, -c               [string]  use specified config file
  --port                     [number]  port to use for serve
  --open                     [boolean] open browser on server start
  --base                     [string]  public base path for build (default: /)
  --outDir                   [string]  output directory for build (default: dist)
  --assetsDir                [string]  directory under outDir to place assets in (default: assets)
  --assetsInlineLimit        [number]  static asset base64 inline threshold in bytes (default: 4096)
  --sourcemap                [boolean] output source maps for build (default: false)
  --minify                   [boolean | 'terser' | 'esbuild'] enable/disable minification, or specify
                                       minifier to use. (default: 'terser')
  --mode, -m                 [string]  specify env mode (default: 'development' for dev, 'production' for build)
  --ssr                      [boolean] build for server-side rendering
  --jsx                      ['vue' | 'preact' | 'react']  choose jsx preset (default: 'vue')
  --jsx-factory              [string]  (default: React.createElement)
  --jsx-fragment             [string]  (default: React.Fragment)
  --force                    [boolean] force the optimizer to ignore the cache and re-bundle
`)
}

console.log(chalk.cyan(`toyserver v${require('../../package.json').version}`))
;(async () => {
  const { help, h, mode, m, version, v } = argv

  if (help || h) {
    logHelp()
    return
  } else if (version || v) {
    // noop, already logged
    return
  }

  const envMode = mode || m || defaultMode
  const options = await resolveOptions(envMode)

  if (options.eject && typeof options.eject === 'object') {
    const ejectPath = path.resolve(process.cwd(), 'resolved.config.js')
    require('fs-extra').writeFileSync(
      options.eject.path || ejectPath,
      require('util').inspect(options, {
        depth: 3
      })
    )
  }

  process.env.NODE_ENV = process.env.NODE_ENV || envMode

  if (options.dryrun) {
    process.exit(1)
  }
  if (!options.command || options.command === 'serve') {
    runServe(options)
  } else if (options.command === 'build') {
    console.error(chalk.red(`not support command: ${options.commad}`))
  } else if (options.command === 'optimize') {
    console.error(chalk.red(`not support command: ${options.commad}`))
  } else {
    console.error(chalk.red(`unknown command: ${options.command}`))
    process.exit(1)
  }
})()

async function resolveOptions(mode: string) {
  // specify env mode
  argv.mode = mode
  // cast xxx=true | false into actual booleans
  Object.keys(argv).forEach((key) => {
    if (argv[key] === 'false') {
      argv[key] = false
    }
    if (argv[key] === 'true') {
      argv[key] = true
    }
  })
  // command
  if (argv._[0]) {
    argv.command = argv._[0]
  }
  // normalize root
  // assumes all commands are in the form of `toyserver [command] [root]`
  if (!argv.root && argv._[1]) {
    argv.root = argv._[1]
  }

  if (argv.root) {
    argv.root = path.isAbsolute(argv.root) ? argv.root : path.resolve(argv.root)
  }

  const userConfig = await resolveConfig(mode, argv.config || argv.c)
  if (userConfig) {
    return {
      ...userConfig,
      ...argv // cli options take higher priority
    }
  }

  return argv
}

async function runServe(options: UserConfig) {
  const server = require('./server').createServer(options)

  let port = options.port || 3000
  let hostname = options.hostname || 'localhost'
  const protocol = options.https ? 'https' : 'http'

  server.on('error', (e: Error & { code?: string }) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying another one...`)
      setTimeout(() => {
        server.close()
        server.listen(++port)
      }, 100)
    } else {
      console.error(chalk.red(`[toyserver] server error:`))
      console.error(e)
    }
  })

  server.listen(port, () => {
    console.log()
    console.log(`  Dev server running at:`)
    const interfaces = os.networkInterfaces()
    Object.keys(interfaces).forEach((key) => {
      ;(interfaces[key] || [])
        .filter((details) => details.family === 'IPv4')
        .map((detail) => {
          return {
            type: detail.address.includes('127.0.0.1')
              ? 'Local:   '
              : 'Network: ',
            host: detail.address.replace('127.0.0.1', hostname)
          }
        })
        .forEach(({ type, host }) => {
          const url = `${protocol}://${host}:${chalk.bold(port)}/`
          console.log(`  > ${type} ${chalk.cyan(url)}`)
        })
    })
    console.log()
    require('debug')('toyserver:server')(
      `server ready in ${Date.now() - start}ms.`
    )

    if (options.open) {
      require('./utils/openBrowser').openBrowser(
        `${protocol}://${hostname}:${port}`
      )
    }
  })
}

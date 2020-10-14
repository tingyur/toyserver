import path from 'path'
import fs from 'fs-extra'
import slash from 'slash'
import {
  moduleRE,
  moduleIdToFileMap,
  moduleFileToIdMap
} from './server/serverPluginModuleResolve'
import { clientPublicPath } from './server/serverPluginClient'
import { resolveOptimizedCacheDir } from './optimizer'
import {
  cleanUrl,
  resolveFrom,
  queryRE,
  lookupFile,
  parseNodeModuleId
} from './utils'

const debug = require('debug')('toyserver:resolve')
const isWin = require('os').platform() === 'win32'
const pathSeparator = isWin ? '\\' : '/'

export interface Resolver {
  requestToFile?(publicPath: string, root: string): string | undefined
  fileToRequest?(filePath: string, root: string): string | undefined
  alias?: ((id: string) => string | undefined) | Record<string, string>
}

export interface InternalResolver {
  requestToFile(publicPath: string): string
  fileToRequest(filePath: string): string
  normalizePublicPath(publicPath: string): string
  alias(id: string): string | undefined
  resolveRelativeRequest(
    publicPath: string,
    relativePublicPath: string
  ): { pathname: string; query: string }
  isPublicRequest(publicPath: string): boolean
}

export const supportedExts = ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
export const mainFields = ['module', 'jsnext', 'jsnext:main', 'browser', 'main']

const defaultRequestToFile = (publicPath: string, root: string): string => {
  if (moduleRE.test(publicPath)) {
    const id = publicPath.replace(moduleRE, '')
    const cachedNodeModule = moduleIdToFileMap.get(id)
    if (cachedNodeModule) {
      return cachedNodeModule
    }
    // try to resolve from optimized modules
    const optimizedModule = resolveOptimizedModule(root, id)
    if (optimizedModule) {
      return optimizedModule
    }
    // try to resolve from normal node_modules
    const nodeModule = resolveNodeModuleFile(root, id)
    if (nodeModule) {
      moduleIdToFileMap.set(id, nodeModule)
      return nodeModule
    }
  }
  const publicDirPath = path.join(root, 'public', publicPath.slice(1))
  if (fs.existsSync(publicDirPath)) {
    return publicDirPath
  }
  return path.join(root, publicPath.slice(1))
}

const defaultFileToRequest = (filePath: string, root: string): string =>
  moduleFileToIdMap.get(filePath) ||
  '/' + slash(path.relative(root, filePath)).replace(/^public\//, '')

const isFile = (file: string): boolean => {
  try {
    return fs.statSync(file).isFile()
  } catch (e) {
    return false
  }
}

/**
 * this function resolve fuzzy file path. examples:
 * /path/file is a fuzzy file path for /path/file.tsx
 * /path/dir is a fuzzy file path for /path/dir/index.js
 *
 * returning undefined indicates the filePath is not fuzzy:
 * it is already an exact file path, or it can't match any file
 */
const resolveFilePathPostfix = (filePath: string): string | undefined => {
  const cleanPath = cleanUrl(filePath)
  if (!isFile(cleanPath)) {
    let postfix = ''
    for (const ext of supportedExts) {
      if (isFile(cleanPath + ext)) {
        postfix = ext
        break
      }
      if (isFile(path.join(cleanPath, '/index' + ext))) {
        postfix = '/index' + ext
        break
      }
    }
    const queryMatch = filePath.match(/\?.*$/)
    const query = queryMatch ? queryMatch[0] : ''
    const resolved = cleanPath + postfix + query
    if (resolved !== filePath) {
      debug(`(postfix) ${filePath} -> ${resolved}`)
      return postfix
    }
  }
}

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory()

export function createResolver(
  root: string,
  resolvers: Resolver[] = [],
  userAlias: Record<string, string> = {}
): InternalResolver {
  resolvers = [...resolvers]
  const literalAlias: Record<string, string> = {}
  const literalDirAlias: Record<string, string> = {}

  const resolveAlias = (alias: Record<string, string>) => {
    for (const key in alias) {
      let target = alias[key]
      // aliasing a directory
      if (key.startsWith('/') && key.endsWith('/') && path.isAbsolute(target)) {
        // check first if this is aliasing to a path from root
        const fromRoot = path.join(root, target)
        if (isDir(fromRoot)) {
          target = fromRoot
        } else if (!isDir(target)) {
          continue
        }
        resolvers.push({
          requestToFile(publicPath) {
            if (publicPath.startsWith(key)) {
              return path.join(target, publicPath.slice(key.length))
            }
          },
          fileToRequest(filePath) {
            if (filePath.startsWith(target + pathSeparator)) {
              return slash(key + path.relative(target, filePath))
            }
          }
        })
        literalDirAlias[key] = target
      } else {
        literalAlias[key] = target
      }
    }
  }

  resolvers.forEach((r) => {
    if (r.alias && typeof r.alias === 'object') {
      resolveAlias(r.alias)
    }
  })
  resolveAlias(userAlias)

  const requestToFileCache = new Map<string, string>()
  const fileToRequestCache = new Map<string, string>()

  const resolver: InternalResolver = {
    requestToFile(publicPath) {
      if (requestToFileCache.has(publicPath)) {
        return requestToFileCache.get(publicPath)!
      }

      let resolved: string | undefined
      for (const r of resolvers) {
        const filepath = r.requestToFile && r.requestToFile(publicPath, root)
        if (filepath) {
          resolved = filepath
          break
        }
      }
      if (!resolved) {
        resolved = defaultRequestToFile(publicPath, root)
      }
      const postfix = resolveFilePathPostfix(resolved)
      if (postfix) {
        if (postfix[0] === '/') {
          resolved = path.join(resolved, postfix)
        } else {
          resolved += postfix
        }
      }
      requestToFileCache.set(publicPath, resolved)
      return resolved
    },

    fileToRequest(filePath) {
      if (fileToRequestCache.has(filePath)) {
        return fileToRequestCache.get(filePath)!
      }
      for (const r of resolvers) {
        const request = r.fileToRequest && r.fileToRequest(filePath, root)
        if (request) return request
      }
      const res = defaultFileToRequest(filePath, root)
      fileToRequestCache.set(filePath, res)
      return res
    },

    /**
     * Given a fuzzy public path, resolve missing extensions and /index.xxx
     */
    normalizePublicPath(publicPath) {
      if (publicPath === clientPublicPath) {
        return publicPath
      }
      // preserve query
      const queryMatch = publicPath.match(/\?.*$/)
      const query = queryMatch ? queryMatch[0] : ''
      const cleanPublicPath = cleanUrl(publicPath)

      const finalize = (result: string) => {
        result += query
        if (
          resolver.requestToFile(result) !== resolver.requestToFile(publicPath)
        ) {
          throw new Error(
            `[vite] normalizePublicPath check fail. please report to vite.`
          )
        }
        return result
      }

      if (!moduleRE.test(cleanPublicPath)) {
        return finalize(
          resolver.fileToRequest(resolver.requestToFile(cleanPublicPath))
        )
      }

      const filePath = resolver.requestToFile(cleanPublicPath)
      const cacheDir = resolveOptimizedCacheDir(root)
      if (cacheDir) {
        const relative = path.relative(cacheDir, filePath)
        if (!relative.startsWith('..')) {
          return finalize(path.posix.join('/@modules/', slash(relative)))
        }
      }

      // fileToRequest doesn't work with files in node_modules
      // because of edge cases like symlinks or yarn-aliased-install
      // or even aliased-symlinks

      // example id: "@babel/runtime/helpers/esm/slicedToArray"
      // see the test case: /playground/TestNormalizePublicPath.vue
      const id = cleanPublicPath.replace(moduleRE, '')
      const { scope, name, inPkgPath } = parseNodeModuleId(id)
      if (!inPkgPath) return publicPath
      let filePathPostFix = ''
      let findPkgFrom = filePath
      while (!filePathPostFix.startsWith(inPkgPath)) {
        // some package contains multi package.json...
        // for example: @babel/runtime@7.10.2/helpers/esm/package.json
        const pkgPath = lookupFile(findPkgFrom, ['package.json'], true)
        if (!pkgPath) {
          throw new Error(
            `[vite] can't find package.json for a node_module file: ` +
              `"${publicPath}". something is wrong.`
          )
        }
        filePathPostFix = slash(path.relative(path.dirname(pkgPath), filePath))
        findPkgFrom = path.join(path.dirname(pkgPath), '../')
      }
      return finalize(
        ['/@modules', scope, name, filePathPostFix].filter(Boolean).join('/')
      )
    },

    alias(id) {
      let aliased: string | undefined = literalAlias[id]
      if (aliased) {
        return aliased
      }
      for (const r of resolvers) {
        aliased =
          r.alias && typeof r.alias === 'function' ? r.alias(id) : undefined
        if (aliased) {
          return aliased
        }
      }
    },

    resolveRelativeRequest(importer: string, importee: string) {
      const queryMatch = importee.match(queryRE)
      let resolved = importee

      if (importee.startsWith('.')) {
        resolved = path.posix.resolve(path.posix.dirname(importer), importee)
        for (const alias in literalDirAlias) {
          if (importer.startsWith(alias)) {
            if (!resolved.startsWith(alias)) {
              // resolved path is outside of alias directory, we need to use
              // its full path instead
              const importerFilePath = resolver.requestToFile(importer)
              const importeeFilePath = path.resolve(
                path.dirname(importerFilePath),
                importee
              )
              resolved = resolver.fileToRequest(importeeFilePath)
            }
            break
          }
        }
      }

      return {
        pathname:
          cleanUrl(resolved) +
          // path resolve strips ending / which should be preserved
          (importee.endsWith('/') && !resolved.endsWith('/') ? '/' : ''),
        query: queryMatch ? queryMatch[0] : ''
      }
    },

    isPublicRequest(publicPath: string) {
      return resolver
        .requestToFile(publicPath)
        .startsWith(path.resolve(root, 'public'))
    }
  }

  return resolver
}

const toyserverOptimizedMap = new Map()

export function resolveOptimizedModule(
  root: string,
  id: string
): string | undefined {
  const cacheKey = `${root}#${id}`
  const cached = toyserverOptimizedMap.get(cacheKey)
  if (cached) {
    return cached
  }

  const cacheDir = resolveOptimizedCacheDir(root)
  if (!cacheDir) return

  const tryResolve = (file: string) => {
    file = path.join(cacheDir, file)
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      toyserverOptimizedMap.set(cacheKey, file)
      return file
    }
  }

  return tryResolve(id) || tryResolve(id + '.js')
}

const nodeModulesFileMap = new Map()

export function resolveNodeModuleFile(
  root: string,
  id: string
): string | undefined {
  const cacheKey = `${root}#${id}`
  const cached = nodeModulesFileMap.get(cacheKey)
  if (cached) {
    return cached
  }
  try {
    const resolved = resolveFrom(root, id)
    nodeModulesFileMap.set(cacheKey, resolved)
    return resolved
  } catch (e) {
    // error will be reported downstream
  }
}

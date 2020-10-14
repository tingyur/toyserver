import path from 'path'
import { lookupFile } from '../utils'

export const OPTIMIZE_CACHE_DIR = `node_modules/.vite_opt_cache`

const cacheDirCache = new Map<string, string | null>()

export function resolveOptimizedCacheDir(
  root: string,
  pkgPath?: string
): string | null {
  const cached = cacheDirCache.get(root)
  if (cached !== undefined) return cached
  pkgPath = pkgPath || lookupFile(root, [`package.json`], true /* pathOnly */)
  if (!pkgPath) {
    return null
  }
  const cacheDir = path.join(path.dirname(pkgPath), OPTIMIZE_CACHE_DIR)
  cacheDirCache.set(root, cacheDir)
  return cacheDir
}

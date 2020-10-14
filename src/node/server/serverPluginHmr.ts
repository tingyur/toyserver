import { FSWatcher } from 'chokidar'
import { HMRPayload } from '../../hmrPayload'

export type HMRWatcher = FSWatcher & {
  handleJSReload: (filePath: string, timestamp?: number) => void
  send: (payload: HMRPayload) => void
}

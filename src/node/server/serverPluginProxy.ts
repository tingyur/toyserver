import { IKoaProxiesOptions } from 'koa-proxies'

export type ProxiesOptions = IKoaProxiesOptions & { ws: boolean }

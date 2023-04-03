import { Codec } from './codec.mjs'

export namespace Share {
  export function set(c: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('share', Codec.encode(c))
    window.history.replaceState(null, null as any, url)
  }
  export function get(): string | undefined {
    const url = new URL(window.location.href)
    const paramValue = url.searchParams.get('share')
    return paramValue === null ? undefined : Codec.decode(paramValue)
  }
}

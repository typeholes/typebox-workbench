export namespace Codec {
  export function encode(c: string) {
    return btoa(c)
  }
  export function decode(c: string) {
    return atob(c)
  }
}

/**
 * Bundled result-sound clips: esbuild inlines each `.ogg` import as a `data:`
 * URL for the client bundle, so this module only ever sees a string.
 */
declare module '*.ogg' {
  const source: string
  export default source
}

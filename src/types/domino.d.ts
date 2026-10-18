// The package's bundled declaration still names the upstream "domino" module.
// Match the published @mixmark-io/domino export used by the Worker converter.
declare module '@mixmark-io/domino' {
  export function createDocument(html?: string, force?: boolean): Document;
}

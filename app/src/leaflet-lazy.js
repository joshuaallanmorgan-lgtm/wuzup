// leaflet-lazy.js — the ONE lazy Leaflet loader (Sprint O audit prep #3).
//
// Before this file, MapView deferred map CREATION to the Map tab's first
// activation but still `import L from 'leaflet'` statically — and DetailPage's
// mini-map did the same — so the full Leaflet bundle (~150 kB raw) rode in the
// BOOT chunk anyway. Both consumers now await getLeaflet(): Vite splits the
// dynamic import into its own chunk, fetched the first time a map is actually
// needed (Map tab activation or a detail page with coordinates).
//
// The promise is cached module-level: every caller shares one fetch, and a
// second call after load resolves on the microtask queue immediately.
// leaflet.css is loaded alongside the JS (Vite injects it with the chunk) so
// a map can never render unstyled. Callers must handle unmount-before-resolve
// themselves (a cancelled flag in their effect cleanup).

let promise = null

export function getLeaflet() {
  if (!promise) {
    promise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(
      ([mod]) => mod.default ?? mod
    )
  }
  return promise
}

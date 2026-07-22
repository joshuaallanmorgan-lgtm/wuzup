import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'

const [main, boundarySource, styles] = await Promise.all([
  readFile(new URL('../app/src/main.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/AppErrorBoundary.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/src/runtime-city.css', import.meta.url), 'utf8'),
])

const vite = await createServer({
  root: fileURLToPath(new URL('../app/', import.meta.url)),
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'silent',
})
let boundaryModule
try {
  boundaryModule = await vite.ssrLoadModule('/src/AppErrorBoundary.jsx')
} finally {
  await vite.close()
}
const { AppErrorBoundary } = boundaryModule

function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node

  const children = Array.isArray(node.props?.children)
    ? node.props.children
    : [node.props?.children]
  for (const child of children) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return null
}

function textContent(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (!node || typeof node !== 'object') return ''
  return textContent(node.props?.children)
}

test('root boundary passes through healthy content and recovers from descendant errors', () => {
  const boundary = new AppErrorBoundary({ children: 'healthy app' })
  assert.deepEqual(boundary.state, { hasError: false })
  assert.equal(boundary.render(), 'healthy app')

  const failedState = AppErrorBoundary.getDerivedStateFromError(new Error('private event title'))
  assert.deepEqual(failedState, { hasError: true })
  boundary.state = failedState

  const fallback = boundary.render()
  assert.equal(fallback.type, 'main')
  assert.equal(fallback.props.role, 'alert')
  assert.equal(fallback.props['aria-live'], 'assertive')
  assert.equal(fallback.props['data-app-runtime-status'], 'failed')
  assert.match(textContent(fallback), /Wuzup couldn't finish this screen/)
})

test('recovery action reloads the document without requiring a browser test', () => {
  const boundary = new AppErrorBoundary({ children: null })
  boundary.state = { hasError: true }
  const button = findElement(boundary.render(), (node) => node.type === 'button')
  assert.ok(button)
  assert.equal(button.props.type, 'button')
  assert.match(textContent(button), /Reload Wuzup/)

  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let reloads = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { reload: () => { reloads += 1 } } },
  })
  try {
    button.props.onClick()
    assert.equal(reloads, 1)
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
    else delete globalThis.window
  }
})

test('diagnostics are fixed, bounded, and never retain thrown state', () => {
  const secret = 'profile-email@example.test/private-plan'
  const boundary = new AppErrorBoundary({ children: null })
  boundary.state = AppErrorBoundary.getDerivedStateFromError(new Error(secret))
  const fallbackText = textContent(boundary.render())

  assert.match(fallbackText, /Support code: WUZUP-RENDER-001/)
  assert.doesNotMatch(fallbackText, new RegExp(secret.replace('/', '\\/')))
  assert.ok(fallbackText.length < 300)
  assert.deepEqual(Object.keys(boundary.state), ['hasError'])
  assert.doesNotMatch(boundarySource, /error\.message|error\.stack|componentStack|localStorage|sessionStorage/)

  const messages = []
  const originalError = console.error
  console.error = (...args) => messages.push(args.join(' '))
  try {
    boundary.componentDidCatch(new Error(secret), { componentStack: secret })
  } finally {
    console.error = originalError
  }
  assert.deepEqual(messages, ['[Wuzup] Root render failed (WUZUP-RENDER-001).'])
  assert.doesNotMatch(messages[0], new RegExp(secret.replace('/', '\\/')))
})

test('verified-city bootstrap owns the boundary without changing fail-closed branches', () => {
  assert.match(main, /import \{ AppErrorBoundary \} from '\.\/AppErrorBoundary\.jsx'/)
  assert.match(main, /if \(RUNTIME_CITY\.ok\)/)
  assert.match(
    main,
    /import\('\.\/App\.jsx'\)[\s\S]*<AppErrorBoundary>[\s\S]*<RuntimeCityProvider selection=\{RUNTIME_CITY\}>[\s\S]*<App \/>/,
  )
  assert.match(main, /CITY_APP_LOAD_FAILED/)
  assert.match(main, /<RuntimeCityFailure selection=\{RUNTIME_CITY\} \/>/)
  assert.match(styles, /\.app-error-boundary button:focus-visible/)
})

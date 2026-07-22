import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, stat, utimes } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { stableDevNativeWatchIgnored, stableDevReload, stableDevSourceFile } from '../app/vite.config.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_CITY = path.join(ROOT, 'finder', 'dev-city.mjs')
const TOUCH_ONLY_PATHS = [
  path.join(ROOT, 'app', 'src', 'CustomEventsProvider.jsx'),
  path.join(ROOT, 'app', 'src', 'ActivityProvider.jsx'),
  path.join(ROOT, 'app', 'src', 'PlannerProvider.jsx'),
  path.join(ROOT, 'app', 'index.html'),
  path.join(ROOT, 'app', 'vite.config.js'),
]

test('stable localhost reloads changed source bytes but ignores generated and touch-only churn', async () => {
  assert.equal(stableDevNativeWatchIgnored(path.join(ROOT, 'app', 'index.html'), true), true)
  assert.equal(stableDevNativeWatchIgnored(path.join(ROOT, 'app', 'vite.config.js'), true), true)
  assert.equal(stableDevNativeWatchIgnored(path.join(ROOT, 'app', 'src', 'App.jsx'), true), false)
  assert.equal(stableDevNativeWatchIgnored(path.join(ROOT, 'app', 'index.html'), false), false)
  for (const file of [
    path.join(ROOT, 'app', 'src', 'App.jsx'),
    path.join(ROOT, 'app', 'src', 'cards.css'),
    path.join(ROOT, 'app', 'index.html'),
    path.join(ROOT, 'app', 'vite.config.js'),
  ]) {
    assert.equal(stableDevSourceFile(file), true, `${file} must remain a stable-reload source input`)
  }
  assert.equal(
    stableDevSourceFile(path.join(ROOT, 'shared', 'rank.mjs'), { modules: [{}] }),
    true,
    'an imported shared module must remain a stable-reload source input',
  )
  for (const file of [
    path.join(ROOT, 'app', 'dist', 'assets', 'app.js'),
    path.join(ROOT, 'app', 'public', 'events.json'),
    path.join(ROOT, 'app', 'node_modules', '.vite', 'deps', 'react.js'),
    path.join(ROOT, 'coverage', 'index.html'),
    path.join(ROOT, 'qa-screenshots', 'home.png'),
    path.join(tmpdir(), 'wuzup-localhost-mobile', '390x844-home.png'),
    path.join(ROOT, 'test', 's10-dev-server.mjs'),
    path.join(ROOT, 'shared', 'flagship-image-review-session.mjs'),
  ]) {
    assert.equal(stableDevSourceFile(file), false, `${file} must not reload stable localhost`)
  }

  let nextTimer = 0
  const scheduled = new Map()
  const cleared = []
  const messages = []
  const sourceBytes = new Map([
    [path.join(ROOT, 'app', 'src', 'App.jsx'), 'app-v1'],
    [path.join(ROOT, 'app', 'src', 'cards.css'), 'cards-v1\n'],
  ])
  const initialFiles = [...sourceBytes.keys()]
  const plugin = stableDevReload({
    enabled: true,
    readSource: async (file) => {
      if (!sourceBytes.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return sourceBytes.get(file)
    },
    initialFiles,
    setTimer(callback, delay) {
      nextTimer += 1
      scheduled.set(nextTimer, { callback, delay })
      return nextTimer
    },
    clearTimer(timer) {
      cleared.push(timer)
      scheduled.delete(timer)
    },
  })
  const environment = { name: 'client', hot: { send: (message) => messages.push(message) } }
  const server = { ws: { send: (message) => messages.push(message) } }
  const update = (options) => plugin.hotUpdate.call({ environment }, {
    type: 'update',
    modules: [],
    ...options,
    server,
  })

  assert.deepEqual(
    await update({ file: path.join(ROOT, 'app', 'dist', 'assets', 'app.js') }),
    [],
  )
  assert.equal(scheduled.size, 0)

  assert.deepEqual(
    await update({ file: path.join(ROOT, 'app', 'src', 'App.jsx'), modules: [{}] }),
    [],
  )
  assert.deepEqual(
    await update({ file: path.join(ROOT, 'app', 'src', 'cards.css'), modules: [{}] }),
    [],
  )
  assert.deepEqual(cleared, [])
  assert.equal(scheduled.size, 0)
  assert.deepEqual(messages, [])

  sourceBytes.set(path.join(ROOT, 'app', 'src', 'cards.css'), 'cards-v1\r\n')
  assert.deepEqual(
    await update({ file: path.join(ROOT, 'app', 'src', 'cards.css'), modules: [{}] }),
    [],
  )
  assert.equal(scheduled.size, 0, 'an unchanged source touch must not schedule a reload')
  assert.deepEqual(messages, [])

  sourceBytes.set(path.join(ROOT, 'app', 'src', 'cards.css'), 'cards-v2')
  assert.deepEqual(
    await update({ file: path.join(ROOT, 'app', 'src', 'cards.css'), modules: [{}] }),
    [],
  )
  assert.deepEqual(cleared, [null])
  assert.equal(scheduled.size, 1, 'a byte change must schedule one reload')
  const changedPending = [...scheduled.values()][0]
  assert.equal(changedPending.delay, 100)
  changedPending.callback()
  assert.deepEqual(messages, [{ type: 'full-reload' }])

  const newRoute = path.join(ROOT, 'app', 'src', 'NewRoute.jsx')
  scheduled.clear()
  messages.length = 0
  sourceBytes.set(newRoute, 'export default function NewRoute() {}\n')
  assert.deepEqual(await update({ type: 'create', file: newRoute }), [])
  assert.equal(scheduled.size, 1, 'a created source file must schedule one atomic reload')
  scheduled.clear()

  sourceBytes.delete(newRoute)
  assert.deepEqual(await update({ type: 'delete', file: newRoute }), [])
  assert.equal(scheduled.size, 1, 'a deleted source file must schedule one atomic reload')
  scheduled.clear()
  assert.deepEqual(await update({ type: 'delete', file: newRoute }), [])
  assert.equal(scheduled.size, 0, 'a repeated delete event must not reload twice')

  assert.equal(
    await plugin.hotUpdate.call({ environment: { name: 'ssr', hot: { send: () => assert.fail('SSR cannot reload') } } }, {
      type: 'update',
      file: path.join(ROOT, 'app', 'src', 'App.jsx'),
      modules: [],
      server,
    }),
    undefined,
  )
})

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function launch(args, env) {
  const child = spawn(process.execPath, [DEV_CITY, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  return { child, closed, output: () => output }
}

async function waitForExit(run, timeoutMs = 15_000) {
  let timer
  try {
    return await Promise.race([
      run.closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`process did not exit:\n${run.output()}`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitForHttp(url, run, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (run.child.exitCode != null) throw new Error(`dev server exited early:\n${run.output()}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`dev server did not become ready:\n${run.output()}`)
}

test('localhost startup is single-owner and touch-only churn preserves the provider graph', { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'wuzup-s10-dev-'))
  const publicRoot = path.join(scratch, 'public')
  const port = await freePort()
  let lockPort = await freePort()
  while (lockPort === port) lockPort = await freePort()
  const args = ['--host', '127.0.0.1', '--port', String(port), '--strictPort']
  const env = {
    CITY: 'tampa-bay',
    DEPLOY_DEST: publicRoot,
    WUZUP_DEV_LOCK_PORT: String(lockPort),
  }
  const originalTimes = new Map()
  let first = null
  let contender = null
  let browser = null

  try {
    await mkdir(publicRoot)
    const left = launch(args, env)
    const right = launch(args, env)
    const settled = await Promise.race([
      waitForExit(left).then((exit) => ({ loser: left, winner: right, exit })),
      waitForExit(right).then((exit) => ({ loser: right, winner: left, exit })),
    ])
    first = settled.winner
    contender = settled.loser
    assert.notEqual(settled.exit.code, 0)
    assert.match(
      contender.output(),
      /REFUSING before artifact staging.*another Wuzup dev server is already running/s,
    )
    const origin = `http://127.0.0.1:${port}`
    await waitForHttp(origin, first)
    assert.match(first.output(), /stable localhost mode enabled/)

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const browserErrors = []
    page.on('pageerror', (error) => browserErrors.push(String(error?.message || error)))
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.locator('.app[data-city-runtime-status="ready"]').waitFor({ state: 'visible' })
    const primer = page.getByRole('dialog', { name: 'Quick taste setup' })
    if (await primer.isVisible()) await primer.getByRole('button', { name: /^Skip/ }).click()

    const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin)
    for (const modulePath of TOUCH_ONLY_PATHS) {
      const metadata = await stat(modulePath)
      originalTimes.set(modulePath, metadata)
      await utimes(modulePath, metadata.atime, new Date())
    }
    await new Promise((resolve) => setTimeout(resolve, 1_250))
    assert.equal(
      await page.evaluate(() => performance.timeOrigin),
      documentTimeOrigin,
      'mtime-only workspace churn must not reload the document',
    )
    await page.locator('.app[data-city-runtime-status="ready"]').waitFor({ state: 'visible' })
    await page.getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Events', exact: true }).click()
    await page.getByRole('heading', { name: 'Events', exact: true }).waitFor({ state: 'visible' })

    assert.equal(
      browserErrors.some((message) => /must be used within .*Provider|WUZUP-RENDER-001/.test(message)),
      false,
      browserErrors.join('\n'),
    )
    assert.equal(
      browserErrors.some((message) => /worker-src|content security policy/i.test(message)),
      false,
      browserErrors.join('\n'),
    )
    assert.equal(await page.getByText('Something went wrong').count(), 0)
    assert.equal((await fetch(origin)).ok, true, 'the original server must remain healthy after the refused launch')
  } finally {
    for (const [modulePath, metadata] of originalTimes) {
      await utimes(modulePath, metadata.atime, metadata.mtime).catch(() => {})
    }
    await browser?.close().catch(() => {})
    if (first && first.child.exitCode == null) {
      if (first.child.connected) first.child.send({ type: 'wuzup-shutdown' })
      await waitForExit(first, 10_000).catch(async () => {
        first.child.kill('SIGTERM')
        await waitForExit(first, 5_000).catch(() => first.child.kill('SIGKILL'))
      })
    }
    if (contender && contender.child.exitCode == null) contender.child.kill('SIGTERM')
    await rm(scratch, { recursive: true, force: true })
  }
})

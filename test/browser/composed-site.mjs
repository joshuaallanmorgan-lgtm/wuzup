import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP_ROOT = join(ROOT, 'app')
const VITE = join(APP_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

const CITY_BUILDS = [
  {
    id: 'tampa-bay',
    basePath: '/wuzup/',
    relativeOutput: 'wuzup',
  },
  {
    id: 'sf-east-bay',
    basePath: '/wuzup/sf/',
    relativeOutput: join('wuzup', 'sf'),
  },
]

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.woff2', 'font/woff2'],
])

function runNode(args, { cwd = ROOT, env = {}, label }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => rejectRun(new Error(`${label} could not start: ${error.message}`)))
    child.on('close', (code, signal) => {
      if (code === 0 && !signal) return resolveRun(output)
      rejectRun(new Error(
        `${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}\n${output.trim()}`
      ))
    })
  })
}

async function buildCity(city, fixtureRoot, siteRoot) {
  const publicRoot = join(fixtureRoot, `public-${city.id}`)
  const outputRoot = join(siteRoot, city.relativeOutput)
  const artifactRoot = join(ROOT, 'finder', 'output', city.id)

  // Reuse the real deployer in a scratch public tree. That preserves the
  // checked-in fonts/icons while mirroring exactly one city's immutable data.
  await cp(join(APP_ROOT, 'public'), publicRoot, { recursive: true })
  await runNode(['finder/deploy.mjs'], {
    env: {
      CITY: city.id,
      DEPLOY_DEST: publicRoot,
    },
    label: `deploy ${city.id}`,
  })

  await runNode([VITE, 'build', '--outDir', outputRoot, '--emptyOutDir'], {
    cwd: APP_ROOT,
    env: {
      VITE_CITY: city.id,
      BASE_PATH: city.basePath,
      WUZUP_PRODUCT_ROOT: '/wuzup/',
      WUZUP_PUBLIC_DIR: publicRoot,
    },
    label: `build ${city.id}`,
  })

  await runNode(['finder/verify-app-build.mjs', outputRoot], {
    env: {
      CITY: city.id,
      WUZUP_ARTIFACT_SOURCE: artifactRoot,
    },
    label: `verify ${city.id}`,
  })

  const manifest = JSON.parse(await readFile(join(artifactRoot, 'artifact-manifest.json'), 'utf8'))
  return {
    ...city,
    assembledAt: manifest.assembledAt,
    buildId: manifest.buildId,
    eventExpiresAt: manifest.artifacts.events.expiresAt,
    manifestId: manifest.manifestId,
    placeExpiresAt: manifest.artifacts.places.expiresAt,
    timeZone: manifest.timeZone,
  }
}

export function releaseFixtureNow(cities) {
  const releases = Object.values(cities)
  const assembled = releases.map((city) => Date.parse(city.assembledAt))
  const eventExpiries = releases.map((city) => Date.parse(city.eventExpiresAt))
  const placeExpiries = releases.map((city) => Date.parse(city.placeExpiresAt))
  if (
    assembled.some((value) => !Number.isFinite(value))
    || eventExpiries.some((value) => !Number.isFinite(value))
    || placeExpiries.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('browser fixture requires valid release, event-expiry, and place-expiry timestamps')
  }
  // Exercise the intentional stale-events/ready-places release state at one
  // instant shared by both city builds. A future refresh that removes this
  // overlap must update the fixture contract instead of silently changing the
  // journey under test.
  const now = Math.max(...assembled, ...eventExpiries) + 1_000
  const placeExpiry = Math.min(...placeExpiries)
  if (now >= placeExpiry) {
    throw new Error('browser fixture has no shared stale-events/ready-places release window')
  }
  return now
}

export async function buildComposedSite() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'wuzup-browser-'))
  const siteRoot = join(fixtureRoot, 'site')
  await mkdir(siteRoot, { recursive: true })
  try {
    const cities = {}
    for (const city of CITY_BUILDS) {
      cities[city.id] = await buildCity(city, fixtureRoot, siteRoot)
    }
    return {
      cities,
      fixtureNow: releaseFixtureNow(cities),
      fixtureRoot,
      siteRoot,
      cleanup: () => rm(fixtureRoot, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(fixtureRoot, { recursive: true, force: true })
    throw error
  }
}

function fileForRequest(siteRoot, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const requestPath = decoded.replace(/^\/+/, '')
  const candidate = resolve(siteRoot, requestPath, decoded.endsWith('/') ? 'index.html' : '')
  const root = resolve(siteRoot)
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  return candidate
}

export async function serveComposedSite(siteRoot) {
  const server = createServer(async (request, response) => {
    const method = request.method || 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      response.writeHead(302, { Location: '/wuzup/' })
      response.end()
      return
    }

    const file = fileForRequest(siteRoot, url.pathname)
    let info = null
    try {
      info = file ? await stat(file) : null
    } catch {
      info = null
    }
    if (!info?.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(`Not found: ${url.pathname}`)
      return
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': info.size,
      'Content-Type': CONTENT_TYPES.get(extname(file).toLowerCase()) || 'application/octet-stream',
    })
    if (method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(file).pipe(response)
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('composed browser server did not expose a TCP address')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    root: relative(ROOT, siteRoot),
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose())
    }),
  }
}

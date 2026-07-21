import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { chromium } from 'playwright'

import { createPlanCapsule, planCapsuleFragment } from '../app/src/plan-capsule.js'
import { ROUTE_STATE_VERSION, serializeRouteHref } from '../app/src/route-state.js'
import { buildComposedSite, serveComposedSite } from './browser/composed-site.mjs'

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')
const FROZEN_NOW = Date.parse('2026-07-16T16:00:00.000Z')
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function dismissPrimer(page) {
  const primer = page.getByRole('dialog', { name: 'Quick taste setup' })
  if (await primer.isVisible()) {
    await primer.getByRole('button', { name: /^Skip/ }).click()
    await primer.waitFor({ state: 'hidden' })
  }
}

async function waitForApp(page) {
  await page.locator('.app[data-city-runtime-status="ready"]').waitFor({ state: 'visible' })
  await dismissPrimer(page)
}

async function openTab(page, label) {
  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('heading', { name: label, exact: true }).waitFor({ state: 'visible' })
}

async function openMyPlans(page) {
  await page.getByRole('navigation', { name: 'Your stuff' })
    .getByRole('button', { name: /^My Plans/ }).click()
  await page.getByRole('heading', { name: /^My Plans/ }).waitFor({ state: 'visible' })
}

async function openTransfer(page) {
  await openTab(page, 'Profile')
  await page.getByRole('navigation', { name: 'Your stuff' })
    .getByRole('button', { name: /^Settings & Preferences/ }).click()
  await page.getByRole('heading', { name: 'Settings & Preferences', exact: true }).waitFor()
  await page.getByRole('button', { name: /Export or restore your data/ }).click()
  await page.getByRole('heading', { name: 'Export & restore', exact: true }).waitFor()
}

async function addFirstSpotToPlan(page) {
  await openTab(page, 'Spots')
  const addButton = page.getByRole('button', { name: /^Add .+ to your day$/ }).first()
  try {
    await addButton.waitFor({ state: 'visible', timeout: 10_000 })
  } catch (error) {
    throw new Error(`spot plan trigger unavailable: ${JSON.stringify({ app: await page.locator('.app').evaluate((node) => ({ ...node.dataset })), text: (await page.locator('body').innerText()).slice(0, 2_000) })}`, { cause: error })
  }
  const match = /^Add (.+) to your day$/.exec(await addButton.getAttribute('aria-label') || '')
  assert.ok(match)
  const title = match[1]
  await addButton.click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
  const detailUrl = page.url()
  const placeId = new URL(detailUrl).searchParams.get('place')
  assert.match(placeId || '', /^p\|/)

  await page.getByRole('button', { name: /Make this my plan/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to a day' })
  await dialog.waitFor()
  await dialog.locator('button.loc-plan-add:not([disabled])').click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'View plan', exact: true }).waitFor()
  return { detailUrl, placeId, title }
}

test('Sprint 9 production route, shared-plan, refresh, and guarded-transfer journey', {
  timeout: 240_000,
}, async () => {
  const executable = chromium.executablePath()
  assert.ok(existsSync(executable), `Playwright Chromium is not installed at ${executable}`)

  let fixture
  let server
  let browser
  try {
    fixture = await buildComposedSite()
    server = await serveComposedSite(fixture.siteRoot)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      locale: 'en-US',
      reducedMotion: 'reduce',
      timezoneId: 'UTC',
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
    })
    await context.addInitScript(({ now }) => {
      const RealDate = Date
      class FrozenDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [now])) }
        static now() { return now }
      }
      globalThis.Date = FrozenDate
    }, { now: FROZEN_NOW })
    await context.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin === server.origin) return route.continue()
      if (url.hostname === 'api.open-meteo.com') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{}}' })
      }
      if (request.resourceType() === 'image') {
        return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
      }
      return route.fulfill({ status: 204, body: '' })
    })

    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const base = `${server.origin}/wuzup/`

    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    const planned = await addFirstSpotToPlan(page)

    await page.goto(planned.detailUrl, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    const directHeading = page.getByRole('heading', { name: planned.title, exact: true })
    try {
      await directHeading.waitFor({ timeout: 10_000 })
    } catch (error) {
      throw new Error(`direct place route did not resolve: ${JSON.stringify({ url: page.url(), app: await page.locator('.app').evaluate((node) => ({ ...node.dataset })), consoleErrors, pageErrors, text: (await page.locator('body').innerText()).slice(0, 2_000) })}`, { cause: error })
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.getByRole('heading', { name: planned.title, exact: true }).waitFor()

    const plannerKey = 'twh:v2:c:tampa-bay:planner-v2'
    const beforeShared = await page.evaluate((key) => localStorage.getItem(key), plannerKey)
    const capsule = createPlanCapsule({
      cityId: 'tampa-bay',
      timeZone: 'America/New_York',
      day: '2026-07-16',
      slots: [{ part: 'afternoon', kind: 'place', primary: planned.placeId, title: planned.title }],
    })
    const sharedRoute = serializeRouteHref({
      v: ROUTE_STATE_VERSION,
      cityId: 'tampa-bay',
      tab: 'plan',
      target: { kind: 'shared-plan' },
    }, { baseUrl: '/wuzup/' }) + planCapsuleFragment(capsule)
    await page.goto(new URL(sharedRoute, server.origin).href, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.getByRole('heading', { name: 'Shared plan', exact: true }).waitFor()
    await page.getByText('Opening it did not change your plans.').waitFor()
    await page.getByRole('heading', { name: planned.title, exact: true }).waitFor()
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), plannerKey), beforeShared)

    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await openTab(page, 'Profile')
    await openMyPlans(page)
    await page.locator('button.pf-dayh-tap').filter({ hasText: planned.title }).waitFor()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await openTab(page, 'Profile')
    await openMyPlans(page)
    await page.locator('button.pf-dayh-tap').filter({ hasText: planned.title }).waitFor()

    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await openTransfer(page)
    const downloadButton = page.getByRole('button', { name: 'Download JSON backup', exact: true })
    await downloadButton.waitFor({ state: 'visible' })
    assert.equal(await downloadButton.isDisabled(), true)
    await page.getByRole('status').filter({ hasText: /still loading or need recovery/ }).waitFor()
    assert.match(await page.locator('.data-transfer').getAttribute('data-transfer-blockers') || '', /saved|activity/)

    await page.addScriptTag({ path: AXE_PATH })
    const serious = await page.evaluate(async () => (await globalThis.axe.run(document.querySelector('.app')))
      .violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
      .map(({ id }) => id))
    assert.deepEqual(serious, [])
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(consoleErrors, [])
    await context.close()
  } finally {
    await browser?.close()
    await server?.close()
    await fixture?.cleanup()
  }
})

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { chromium } from 'playwright'
import { buildComposedSite, serveComposedSite } from './browser/composed-site.mjs'

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')
// The checked-in legacy event packs expired before their July 15 manifests
// were assembled. July 16 is therefore the first honest shared fixture time:
// event failure is stale (and visible), while both verified place packs remain
// current enough to drive the canonical add/remove planner journey.
const FROZEN_NOW = Date.parse('2026-07-16T16:00:00.000Z')
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

const CITY_EXPECTATIONS = {
  'tampa-bay': {
    name: 'Tampa Bay',
    path: '/wuzup/',
    switchLabel: /Tampa Bay area/,
  },
  'sf-east-bay': {
    name: 'SF & East Bay',
    path: '/wuzup/sf/',
    switchLabel: /SF to the East Bay/,
  },
}
let documentMarkerSequence = 0

function chromiumSetupError() {
  const executable = chromium.executablePath()
  if (existsSync(executable)) return null
  return new Error(
    `Playwright Chromium is not installed at ${executable}. `
    + 'Install the browser explicitly with: npx playwright install chromium'
  )
}

async function dismissPrimer(page) {
  const primer = page.getByRole('dialog', { name: 'Quick taste setup' })
  if (await primer.isVisible()) {
    await primer.getByRole('button', { name: /^Skip/ }).click()
    await primer.waitFor({ state: 'hidden' })
  }
}

async function assertNoSeriousAxeViolations(page, cityName) {
  if (!await page.evaluate(() => Boolean(globalThis.axe))) {
    await page.addScriptTag({ path: AXE_PATH })
  }
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document.querySelector('.app'), {
      resultTypes: ['violations'],
    })
    return result.violations
      .filter(({ impact }) => impact === 'serious' || impact === 'critical')
      .map(({ help, id, impact, nodes }) => ({
        help,
        id,
        impact,
        targets: nodes.map((node) => node.target),
      }))
  })
  assert.deepEqual(violations, [], `${cityName} serious/critical axe violations:\n${JSON.stringify(violations, null, 2)}`)
}

async function assertCityIdentity(page, built, expectation) {
  const app = page.locator('.app[data-city-runtime-status="ready"]')
  await app.waitFor({ state: 'visible' })
  await page.waitForFunction(
    ({ manifestId }) => {
      const root = document.querySelector('.app')
      return root?.dataset.artifactStatus === 'stale'
        && root?.dataset.manifestId === manifestId
    },
    { manifestId: built.manifestId }
  )

  assert.equal(new URL(page.url()).pathname, expectation.path)
  assert.equal(await app.getAttribute('data-city-id'), built.id)
  assert.equal(await app.getAttribute('data-city-time-zone'), built.timeZone)
  assert.equal(await app.getAttribute('data-artifact-status'), 'stale')
  assert.equal(await app.getAttribute('data-manifest-id'), built.manifestId)
  assert.equal(await app.getAttribute('data-build-id'), built.buildId)
  assert.match(await page.title(), new RegExp(expectation.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  await dismissPrimer(page)
  await assertNoSeriousAxeViolations(page, expectation.name)
}

async function openTab(page, label) {
  const nav = page.getByRole('navigation', { name: 'Primary navigation' })
  await nav.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('heading', { name: label, exact: true }).waitFor({ state: 'visible' })
}

async function addPlanFromSpots(page) {
  await openTab(page, 'Spots')
  const addButton = page.getByRole('button', { name: /^Add .+ to your day$/ }).first()
  await addButton.waitFor({ state: 'visible' })
  const addLabel = await addButton.getAttribute('aria-label')
  const match = /^Add (.+) to your day$/.exec(addLabel || '')
  assert.ok(match, `expected a place add label, received '${addLabel}'`)
  const title = match[1]

  await addButton.click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' })
  const openSheet = page.locator('button.detail-actionbar-cta:not([disabled])').filter({ hasText: /Make this my plan/ })
  await openSheet.waitFor({ state: 'visible' })
  await openSheet.click()

  const dialog = page.getByRole('dialog', { name: 'Add to a day' })
  await dialog.waitFor({ state: 'visible' })
  const confirm = dialog.locator('button.loc-plan-add:not([disabled])')
  await confirm.waitFor({ state: 'visible' })
  await confirm.click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'View plan', exact: true }).waitFor({ state: 'visible' })

  await page.locator('button.detail-back').click()
  await page.getByRole('heading', { name: 'Spots', exact: true }).waitFor({ state: 'visible' })
  return title
}

async function openProfile(page) {
  await openTab(page, 'Profile')
}

async function openMyPlans(page) {
  const menu = page.getByRole('navigation', { name: 'Your stuff' })
  await menu.getByRole('button', { name: /^My Plans/ }).click()
  await page.getByRole('heading', { name: /^My Plans/ }).waitFor({ state: 'visible' })
}

async function assertPlanVisible(page, title) {
  await page.locator('button.pf-dayh-tap').filter({ hasText: title }).first().waitFor({ state: 'visible' })
}

async function assertPlansEmpty(page, absentTitle) {
  await page.getByText(/No plans yet/).waitFor({ state: 'visible' })
  assert.equal(
    await page.locator('button.pf-dayh-tap').filter({ hasText: absentTitle }).count(),
    0,
    `${absentTitle} leaked into the active city's My Plans view`
  )
}

async function closeSubpage(page) {
  const back = page.getByRole('button', { name: 'Back', exact: true })
  try {
    await back.click()
  } catch (error) {
    const notices = page.locator('.load-note.is-layered')
    const noticeGeometry = []
    for (let index = 0; index < await notices.count(); index += 1) {
      const notice = notices.nth(index)
      noticeGeometry.push({
        box: await notice.boundingBox(),
        className: await notice.getAttribute('class'),
        text: (await notice.innerText()).trim(),
      })
    }
    throw new Error(
      `subpage-back pointer activation failed; geometry=${JSON.stringify({ notices: noticeGeometry, target: await back.boundingBox() })}\n${error.message}`,
      { cause: error }
    )
  }
  await page.getByRole('heading', { name: 'Profile', exact: true }).waitFor({ state: 'visible' })
}

async function removePlanFromMyPlans(page, title) {
  const plannedDay = page.locator('button.pf-dayh-tap').filter({ hasText: title }).first()
  try {
    await plannedDay.click()
  } catch (error) {
    const notice = page.locator('.load-note.is-layered.is-stacked').first()
    const geometry = {
      notice: await notice.boundingBox(),
      target: await plannedDay.boundingBox(),
    }
    throw new Error(
      `planned-day pointer activation failed; geometry=${JSON.stringify(geometry)}\n${error.message}`,
      { cause: error }
    )
  }
  await page.getByRole('heading', { name: 'Plan Your Day', exact: true }).waitFor({ state: 'visible' })

  await page.getByRole('button', { name: `Options for ${title}`, exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Plan item options' })
  await menu.getByRole('button', { name: 'Remove from plan', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Removed from your plan' }).waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: `Options for ${title}`, exact: true }).count(), 0)

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('heading', { name: 'Profile', exact: true }).waitFor({ state: 'visible' })
  await openMyPlans(page)
  await assertPlansEmpty(page, title)
}

async function hardSwitchCity(page, expectation) {
  const menu = page.getByRole('navigation', { name: 'Your stuff' })
  await menu.getByRole('button', { name: /^Settings & Preferences/ }).click()
  await page.getByRole('heading', { name: 'Settings & Preferences', exact: true }).waitFor({ state: 'visible' })

  const coverage = page.getByRole('navigation', { name: 'Available Wuzup coverage areas' })
  const link = coverage.getByRole('link', { name: expectation.switchLabel })
  const destination = new URL(await link.getAttribute('href'), page.url())
  assert.equal(destination.pathname, expectation.path)

  const marker = `document-${++documentMarkerSequence}`
  await page.evaluate((value) => { globalThis.__WUZUP_BROWSER_DOCUMENT__ = value }, marker)
  try {
    await link.click()
  } catch (error) {
    const notices = page.locator('.load-note.is-layered')
    const noticeGeometry = []
    for (let index = 0; index < await notices.count(); index += 1) {
      const notice = notices.nth(index)
      noticeGeometry.push({
        box: await notice.boundingBox(),
        className: await notice.getAttribute('class'),
        text: (await notice.innerText()).trim(),
      })
    }
    throw new Error(
      `coverage-link pointer activation failed; geometry=${JSON.stringify({ notices: noticeGeometry, target: await link.boundingBox() })}\n${error.message}`,
      { cause: error }
    )
  }

  // Playwright emits no new commit/DOMContentLoaded lifecycle when Chromium
  // restores the previously visited city document from BFCache. Poll the real
  // main-frame URL plus the per-document marker so both network navigations
  // and BFCache restores prove a hard document swap (an SPA cannot clear it).
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const current = new URL(page.url())
    if (current.origin === destination.origin && current.pathname === expectation.path) {
      try {
        const after = await page.evaluate(() => globalThis.__WUZUP_BROWSER_DOCUMENT__)
        if (after !== marker) return
      } catch {
        // The execution context is between documents; retry against the next one.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(`coverage switch did not replace the browser document; current URL is ${page.url()}`)
}

test('the composed Tampa and SF production builds keep the canonical plan journey city-scoped', {
  timeout: 240_000,
}, async () => {
  const setupError = chromiumSetupError()
  if (setupError) throw setupError

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
    })

    await context.addInitScript(({ now }) => {
      const RealDate = Date
      class FrozenDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [now]))
        }
        static now() {
          return now
        }
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

    const tampa = fixture.cities['tampa-bay']
    const sf = fixture.cities['sf-east-bay']
    const tampaExpectation = CITY_EXPECTATIONS['tampa-bay']
    const sfExpectation = CITY_EXPECTATIONS['sf-east-bay']

    await page.goto(`${server.origin}${tampaExpectation.path}`, { waitUntil: 'domcontentloaded' })
    await assertCityIdentity(page, tampa, tampaExpectation)
    const tampaTitle = await addPlanFromSpots(page)
    await openTab(page, 'Plan')
    await openProfile(page)
    await openMyPlans(page)
    await assertPlanVisible(page, tampaTitle)
    await closeSubpage(page)

    await hardSwitchCity(page, sfExpectation)
    await assertCityIdentity(page, sf, sfExpectation)
    await openProfile(page)
    await openMyPlans(page)
    await assertPlansEmpty(page, tampaTitle)
    await closeSubpage(page)

    const sfTitle = await addPlanFromSpots(page)
    await openTab(page, 'Plan')
    await openProfile(page)
    await openMyPlans(page)
    await assertPlanVisible(page, sfTitle)
    await removePlanFromMyPlans(page, sfTitle)
    await closeSubpage(page)

    await hardSwitchCity(page, tampaExpectation)
    await assertCityIdentity(page, tampa, tampaExpectation)
    await openProfile(page)
    await openMyPlans(page)
    await assertPlanVisible(page, tampaTitle)
    if (sfTitle !== tampaTitle) {
      assert.equal(
        await page.locator('button.pf-dayh-tap').filter({ hasText: sfTitle }).count(),
        0,
        `${sfTitle} leaked into Tampa's My Plans view`
      )
    }

    const plannerState = await page.evaluate(() => ({
      sf: localStorage.getItem('twh:v2:c:sf-east-bay:planner-v2'),
      tampa: localStorage.getItem('twh:v2:c:tampa-bay:planner-v2'),
    }))
    assert.ok(plannerState.sf, 'SF planner state must use its physical city key')
    assert.ok(plannerState.tampa, 'Tampa planner state must use its physical city key')
    assert.notEqual(plannerState.sf, plannerState.tampa, 'city planner documents must remain independent')

    await removePlanFromMyPlans(page, tampaTitle)

    // Minimal fail-closed state: an unknown explicit city signal must stop
    // before App or any listing pack mounts, while remaining a clean render.
    await page.goto(`${server.origin}/wuzup/?city=not-a-city`, { waitUntil: 'domcontentloaded' })
    const blocked = page.locator('[data-city-runtime-status="blocked"]')
    await blocked.waitFor({ state: 'visible' })
    await page.getByRole('alert').getByText('That coverage area is not available in this version of Wuzup.').waitFor()
    assert.equal(await page.locator('.app').count(), 0)

    assert.deepEqual(pageErrors, [], `page errors:\n${pageErrors.join('\n')}`)
    assert.deepEqual(consoleErrors, [], `console errors:\n${consoleErrors.join('\n')}`)
    await context.close()
  } finally {
    await browser?.close()
    await server?.close()
    await fixture?.cleanup()
  }
})

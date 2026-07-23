import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { chromium } from 'playwright'

import { buildComposedSite, serveComposedSite } from './browser/composed-site.mjs'

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const VIEWPORTS = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 },
]
const DIRECT_EVENTS_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]

function createChunkGate(chunkName) {
  let signalRequested
  let releaseRequest
  let intercepted = false
  const requested = new Promise((resolve) => { signalRequested = resolve })
  const released = new Promise((resolve) => { releaseRequest = resolve })
  const matches = (url) => {
    const file = url.pathname.split('/').pop() || ''
    return file.startsWith(`${chunkName}-`) && file.endsWith('.js')
  }
  return {
    async intercept(url) {
      if (!matches(url)) return false
      if (!intercepted) {
        intercepted = true
        signalRequested(url.href)
      }
      await released
      return true
    },
    release() {
      releaseRequest()
    },
    async waitUntilRequested(timeoutMs = 10_000) {
      let timer
      try {
        return await Promise.race([
          requested,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${chunkName} chunk was not requested`)), timeoutMs)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

function freezeClock(context, now) {
  return context.addInitScript(({ now }) => {
    const RealDate = Date
    class FrozenDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [now])) }
      static now() { return now }
    }
    globalThis.Date = FrozenDate
  }, { now })
}

async function installRoutes(context, server, rejectedImages, chunkGate = null) {
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === server.origin) {
      await chunkGate?.intercept(url)
      return route.continue()
    }
    if (url.hostname === 'api.open-meteo.com') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{}}' })
    }
    if (request.resourceType() === 'image') {
      if (url.hostname !== 'upload.wikimedia.org') rejectedImages.push(url.href)
      return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
    }
    return route.fulfill({ status: 204, body: '' })
  })
}

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
  if (label === 'Home') {
    await page.locator('section.page[aria-label="Home"]:not([aria-hidden="true"]) .loc-head-title')
      .waitFor({ state: 'visible' })
  } else {
    await page.getByRole('heading', { name: label, exact: true }).waitFor({ state: 'visible' })
  }
}

async function assertNoDocumentOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }))
  assert.ok(
    geometry.documentScroll <= geometry.documentClient + 1 && geometry.bodyScroll <= geometry.bodyClient + 1,
    `${label} has horizontal document overflow: ${JSON.stringify(geometry)}`,
  )
}

async function assertRootWidthContract(page, viewport) {
  const geometry = await page.locator('#root').evaluate((root) => {
    const rect = root.getBoundingClientRect()
    return {
      leftGutter: rect.left,
      rightGutter: innerWidth - rect.right,
      rootWidth: rect.width,
      viewportWidth: innerWidth,
    }
  })
  if (viewport.width <= 390) {
    assert.ok(
      Math.abs(geometry.rootWidth - geometry.viewportWidth) <= 1,
      `#root must fill the ${viewport.width}px mobile viewport: ${JSON.stringify(geometry)}`,
    )
    return
  }
  assert.ok(
    geometry.rootWidth <= 461,
    `#root must retain the owner-approved 460px desktop frame: ${JSON.stringify(geometry)}`,
  )
  assert.ok(
    Math.abs(geometry.leftGutter - geometry.rightGutter) <= 1,
    `#root must stay centered at ${viewport.width}px: ${JSON.stringify(geometry)}`,
  )
}

async function assertSharedMobileHeading(page, label, viewport) {
  const pageSelector = label === 'Home'
    ? 'section.page[aria-label="Home"]:not([aria-hidden="true"])'
    : `section.page[aria-label="${label}"]:not([aria-hidden="true"])`
  const heading = page.locator(`${pageSelector} .loc-head-title`).first()
  await heading.waitFor({ state: 'visible' })
  const geometry = await heading.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return {
      fontSize: Number.parseFloat(style.fontSize),
      left: rect.left,
      width: rect.width,
    }
  })
  const expectedGutter = viewport.width < 360 ? 14 : 20
  assert.ok(
    Math.abs(geometry.left - expectedGutter) <= 1,
    `${label} heading must use the shared ${expectedGutter}px mobile gutter: ${JSON.stringify(geometry)}`,
  )
  assert.equal(geometry.fontSize, 32, `${label} heading must use the shared 32px title step`)
}

async function assertNoNestedInteractiveControls(page, label) {
  const nested = await page.evaluate(() => [...document.querySelectorAll('button')].flatMap((outer) => {
    const invalid = [
      ...outer.querySelectorAll('button'),
      ...[...outer.querySelectorAll('[role="button"]')].filter((node) => node.tabIndex >= 0),
    ]
    return invalid.map((inner) => ({
      inner: `${inner.tagName.toLowerCase()}.${inner.className || ''}`,
      outer: `button.${outer.className || ''}`,
    }))
  }))
  assert.deepEqual(nested, [], `${label} nested interactive controls: ${JSON.stringify(nested)}`)
}

async function assertNoSeriousAxeViolations(page, label) {
  if (!await page.evaluate(() => Boolean(globalThis.axe))) await page.addScriptTag({ path: AXE_PATH })
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document.querySelector('.app'), { resultTypes: ['violations'] })
    return result.violations
      .filter(({ impact }) => impact === 'serious' || impact === 'critical')
      .map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }))
  })
  assert.deepEqual(violations, [], `${label} serious/critical Axe violations: ${JSON.stringify(violations, null, 2)}`)
}

async function addFirstSpotToPlan(page) {
  const addButton = page.getByRole('button', { name: /^Add .+ to your day$/ }).first()
  await addButton.waitFor({ state: 'visible' })
  const label = await addButton.getAttribute('aria-label') || ''
  const match = /^Add (.+) to your day$/.exec(label)
  assert.ok(match, `unexpected spot plan label: ${label}`)
  const title = match[1]
  await addButton.click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /Make this my plan/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Add to a day' })
  await dialog.waitFor({ state: 'visible' })
  await dialog.locator('button.loc-plan-add:not([disabled])').click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'View plan', exact: true }).waitFor({ state: 'visible' })
  await page.locator('button.detail-back').click()
  await page.getByRole('heading', { name: 'Spots', exact: true }).waitFor({ state: 'visible' })
  return title
}

test('Sprint 10 production accessibility, lazy-loading, responsive, and image-policy journey', {
  timeout: 150_000,
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
    const base = `${server.origin}/wuzup/`

    // Strict production boot: no test-only CSP bypass and no Axe injection.
    const strictRejectedImages = []
    const strictContext = await browser.newContext({
      locale: 'en-US',
      reducedMotion: 'reduce',
      timezoneId: 'UTC',
      viewport: { width: 390, height: 844 },
    })
    await freezeClock(strictContext, fixture.fixtureNow)
    await installRoutes(strictContext, server, strictRejectedImages)
    const strictPage = await strictContext.newPage()
    const strictConsole = []
    const strictErrors = []
    strictPage.on('console', (message) => {
      if (message.type() === 'error') strictConsole.push(message.text())
    })
    strictPage.on('pageerror', (error) => strictErrors.push(error.message))
    await strictPage.goto(base, { waitUntil: 'domcontentloaded' })
    await waitForApp(strictPage)
    assert.deepEqual(strictErrors, [], `strict-CSP page errors: ${strictErrors.join('\n')}`)
    assert.deepEqual(
      strictConsole.filter((message) => /content security policy|refused to/i.test(message)),
      [],
      `strict-CSP console violations: ${strictConsole.join('\n')}`,
    )
    assert.deepEqual(strictRejectedImages, [], `strict-CSP unapproved image requests: ${strictRejectedImages.join('\n')}`)
    await strictContext.close()

    // Exercise Axe while the real tab entrance is still running under the
    // default motion preference. Reduced-motion-only coverage used to mask an
    // ancestor opacity fade that temporarily lowered every descendant's
    // effective contrast. Stretching the transform-only settle makes this
    // deterministic without changing production CSS.
    const motionRejectedImages = []
    const motionContext = await browser.newContext({
      bypassCSP: true,
      locale: 'en-US',
      reducedMotion: 'no-preference',
      timezoneId: 'UTC',
      viewport: { width: 390, height: 844 },
    })
    await freezeClock(motionContext, fixture.fixtureNow)
    await installRoutes(motionContext, server, motionRejectedImages)
    const motionPage = await motionContext.newPage()
    await motionPage.goto(base, { waitUntil: 'domcontentloaded' })
    await waitForApp(motionPage)
    assert.equal(
      await motionPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      false,
      'default-motion contrast coverage must not run in reduced-motion mode',
    )
    await motionPage.addStyleTag({
      content: '.page.tab-settle { animation-duration: 10s !important; }',
    })
    await openTab(motionPage, 'Events')
    const settlingPage = motionPage.locator('section.page.tab-settle[aria-label="Events"]')
    await settlingPage.waitFor({ state: 'visible' })
    const settlingStyle = await settlingPage.evaluate((node) => {
      const style = getComputedStyle(node)
      return { animationName: style.animationName, opacity: style.opacity }
    })
    assert.equal(settlingStyle.animationName, 'tabSettle', 'the default-motion entrance must still be in flight')
    assert.equal(settlingStyle.opacity, '1', 'a moving content surface must remain fully opaque')
    await assertNoSeriousAxeViolations(motionPage, 'default-motion Events entrance')
    assert.deepEqual(
      motionRejectedImages,
      [],
      `default-motion unapproved image requests: ${motionRejectedImages.join('\n')}`,
    )
    await motionContext.close()

    // A URL-restored tab owns both selected navigation and physical pager
    // position on the first frame. The prior split state selected the right
    // tab while still showing Home.
    const directRejectedImages = []
    const directContext = await browser.newContext({
      bypassCSP: true,
      locale: 'en-US',
      reducedMotion: 'reduce',
      timezoneId: 'UTC',
      viewport: { width: 390, height: 844 },
    })
    await freezeClock(directContext, fixture.fixtureNow)
    await installRoutes(directContext, server, directRejectedImages)
    const directPage = await directContext.newPage()
    for (const [routeTab, label, index] of [
      ['events', 'Events', 1],
      ['spots', 'Spots', 2],
      ['plan', 'Plan', 3],
      ['profile', 'Profile', 4],
    ]) {
      await directPage.goto(`${base}?city=tampa-bay&tab=${routeTab}`, { waitUntil: 'domcontentloaded' })
      await waitForApp(directPage)
      const activeSection = directPage.locator(`section.page[aria-label="${label}"]:not([aria-hidden="true"])`)
      await activeSection.waitFor({ state: 'visible' })
      await activeSection.getByRole('heading', { name: label, exact: true }).waitFor({ state: 'visible' })
      const pager = await directPage.locator('.pager').evaluate((node) => ({
        clientWidth: node.clientWidth,
        scrollLeft: node.scrollLeft,
      }))
      assert.ok(
        Math.abs(pager.scrollLeft - index * pager.clientWidth) <= 1,
        `direct ${label} must align pager index ${index}: ${JSON.stringify(pager)}`,
      )
      await assertNoDocumentOverflow(directPage, `direct ${label} route`)
    }
    assert.deepEqual(directRejectedImages, [], `direct-route unapproved image requests: ${directRejectedImages.join('\n')}`)
    await directContext.close()

    // Axe is injected by Playwright, not shipped by Wuzup. The bypass exists
    // only in this context; the strict context above proves production boot.
    const rejectedImages = []
    const myPlansChunkGate = createChunkGate('MyPlansPage')
    const context = await browser.newContext({
      bypassCSP: true,
      locale: 'en-US',
      reducedMotion: 'reduce',
      timezoneId: 'UTC',
      viewport: { width: 390, height: 844 },
    })
    await freezeClock(context, fixture.fixtureNow)
    await installRoutes(context, server, rejectedImages, myPlansChunkGate)
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    let placesRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/places.json')) placesRequests += 1
    })
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await waitForApp(page)
    await page.waitForLoadState('networkidle')
    assert.equal(placesRequests, 0, 'settled Home must not request places.json')
    await assertNoNestedInteractiveControls(page, 'Home')
    await assertNoSeriousAxeViolations(page, 'resting Home')

    // Events is opened before the lazy Spots route on purpose. The shared
    // search opener must bring its own CSS instead of waiting for the Spots
    // chunk to install the mobile pill, heading, or touch-target styles. Plan
    // and Profile exercise the same eager heading primitive before Spots too.
    for (const viewport of DIRECT_EVENTS_VIEWPORTS) {
      await page.setViewportSize(viewport)
      await openTab(page, 'Home')
      await assertSharedMobileHeading(page, 'Home', viewport)
      await openTab(page, 'Events')
      await assertSharedMobileHeading(page, 'Events', viewport)
      const eventSearch = page.getByRole('button', { name: 'Search events', exact: true })
      await eventSearch.waitFor({ state: 'visible' })
      const geometry = await eventSearch.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          borderRadius: Number.parseFloat(style.borderRadius),
          display: style.display,
          height: rect.height,
          width: rect.width,
        }
      })
      assert.equal(geometry.display, 'flex', `direct Events search must be styled at ${viewport.width}px`)
      assert.ok(geometry.height >= 44, `direct Events search must be at least 44px tall: ${JSON.stringify(geometry)}`)
      assert.ok(
        geometry.width >= viewport.width - 60,
        `direct Events search must retain its full-width pill: ${JSON.stringify(geometry)}`,
      )
      assert.ok(
        geometry.borderRadius >= 20,
        `direct Events search must retain its pill radius: ${JSON.stringify(geometry)}`,
      )
      const expectedGutter = viewport.width < 360 ? 14 : 20
      assert.ok(
        Math.abs((await eventSearch.boundingBox()).x - expectedGutter) <= 1,
        `direct Events search must use the shared ${expectedGutter}px mobile gutter`,
      )
      assert.equal(placesRequests, 0, 'opening Events must not activate the Spots route or artifact')
      await assertNoDocumentOverflow(page, `direct Events ${viewport.width}px`)
      await assertNoSeriousAxeViolations(page, `direct Events ${viewport.width}px`)
      await openTab(page, 'Plan')
      await assertSharedMobileHeading(page, 'Plan', viewport)
      await assertNoSeriousAxeViolations(page, `direct Plan ${viewport.width}px`)
      await openTab(page, 'Profile')
      await assertSharedMobileHeading(page, 'Profile', viewport)
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await openTab(page, 'Spots')
    const spotsPage = page.locator('section.page[aria-label="Spots"]:not([aria-hidden="true"])')
    const spotsScroll = spotsPage.locator('.hot-scroll')
    const firstRankedSpot = spotsPage.locator('.spotcard--row').first()
    await firstRankedSpot.waitFor({ state: 'visible' })
    assert.equal(placesRequests, 1, 'first Spots visit must request places.json exactly once')
    const firstSpot390 = await firstRankedSpot.evaluate((node) => node.getBoundingClientRect().top)
    assert.ok(firstSpot390 < 844, `the ranked Spots lead must begin in the 390px first viewport, got y=${firstSpot390}`)
    const clippedSpotText = await spotsPage.locator('.spotcard--row').evaluateAll((rows) => rows.slice(0, 3).flatMap((row, rowIndex) =>
      [...row.querySelectorAll('.spotcard-title, .spotcard-loc, .spotcard-facts, .spotcard-amen, .spotcard-bestfor')]
        .filter((node) => node.scrollHeight > node.clientHeight + 1)
        .map((node) => ({ rowIndex, className: node.className, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }))))
    assert.deepEqual(clippedSpotText, [], `ranked Spots cards must not vertically crush text: ${JSON.stringify(clippedSpotText)}`)
    const spotActionOverlaps = await spotsPage.locator('.spotcard--row').evaluateAll((rows) => rows.slice(0, 3).flatMap((row, rowIndex) => {
      const action = row.querySelector('.spotcard-add')?.getBoundingClientRect()
      if (!action) return [{ rowIndex, missingAction: true }]
      return [...row.querySelectorAll('.spotcard-title, .spotcard-loc, .spotcard-facts, .spotcard-amen')]
        .filter((node) => {
          const rect = node.getBoundingClientRect()
          return rect.left < action.right && rect.right > action.left && rect.top < action.bottom && rect.bottom > action.top
        })
        .map((node) => ({ rowIndex, className: node.className }))
    }))
    assert.deepEqual(spotActionOverlaps, [], `ranked Spots text must not run under Add to day: ${JSON.stringify(spotActionOverlaps)}`)
    await page.setViewportSize({ width: 320, height: 568 })
    await spotsScroll.evaluate((node) => { node.scrollTop = 0 })
    const firstSpot320 = await firstRankedSpot.evaluate((node) => node.getBoundingClientRect().top)
    const tabbarTop320 = await page.locator('.tabbar').evaluate((node) => node.getBoundingClientRect().top)
    assert.ok(firstSpot320 < 568, `the ranked Spots lead must begin in the 320px first viewport, got y=${firstSpot320}`)
    assert.ok(firstSpot320 < tabbarTop320, `the ranked Spots lead must begin above the mobile tabbar, got y=${firstSpot320}, tabbar=${tabbarTop320}`)
    await page.setViewportSize({ width: 390, height: 844 })
    await spotsScroll.evaluate((node) => { node.scrollTop = 0 })
    await openTab(page, 'Home')
    await openTab(page, 'Spots')
    assert.equal(placesRequests, 1, 'tab hops must reuse the one place artifact request')
    await assertNoNestedInteractiveControls(page, 'Spots')

    // Open and Save are separate native sibling controls. The immutable browser
    // fixture is intentionally stale, so retained-value writes are disabled;
    // Enter on the opener must still open detail without changing Save state.
    const row = page.locator('.spotcard--row').first()
    const rowOpen = row.locator(':scope > button.spotcard-open')
    const rowSave = row.locator(':scope > button.save-btn')
    assert.equal(await rowOpen.count(), 1)
    assert.equal(await rowSave.count(), 1)
    assert.equal(await rowOpen.locator('button, [role="button"]').count(), 0)
    const savedBeforeOpen = await rowSave.getAttribute('aria-pressed')
    await rowSave.waitFor({ state: 'visible' })
    await rowOpen.focus()
    await page.keyboard.press('Enter')
    await page.locator('.detail').waitFor({ state: 'visible' })
    assert.equal(
      await page.locator('button.detail-save-btn').getAttribute('aria-pressed'),
      savedBeforeOpen,
      'Enter on open must not toggle Save',
    )
    await page.locator('button.detail-back').click()
    await page.getByRole('heading', { name: 'Spots', exact: true }).waitFor({ state: 'visible' })

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await assertRootWidthContract(page, viewport)
      await openTab(page, 'Home')
      await assertNoDocumentOverflow(page, `Home ${viewport.width}px`)
      await openTab(page, 'Spots')
      await assertNoDocumentOverflow(page, `Spots ${viewport.width}px`)
    }
    assert.equal(placesRequests, 1, 'responsive and tab checks must not duplicate the place request')

    // Hold a route without its own autofocus behavior. The stable subpage
    // wrapper receives temporary focus; resolving the real MyPlansPage chunk
    // must advance focus to Back before close restores the exact launcher.
    await openTab(page, 'Profile')
    const myPlansTrigger = page.getByRole('navigation', { name: 'Your stuff' })
      .getByRole('button', { name: /^My Plans/ })
    const myPlansTriggerHandle = await myPlansTrigger.elementHandle()
    assert.ok(myPlansTriggerHandle)
    await myPlansTrigger.click()
    await myPlansChunkGate.waitUntilRequested()
    const loadingRoute = page.getByRole('status', { name: 'Loading this view', exact: true })
    await loadingRoute.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.activeElement?.matches('.subpage'))
    myPlansChunkGate.release()
    const plansBack = page.getByRole('button', { name: 'Back', exact: true })
    await plansBack.waitFor({ state: 'visible' })
    const plansBackHandle = await plansBack.elementHandle()
    assert.ok(plansBackHandle)
    await page.waitForFunction((back) => document.activeElement === back, plansBackHandle)
    await plansBack.click()
    await page.waitForFunction((trigger) => document.activeElement === trigger, myPlansTriggerHandle)

    // Search is another lazy subpage. Its resolved input receives focus, then
    // Back returns to the exact still-mounted Spots trigger.
    await openTab(page, 'Spots')
    const searchTrigger = page.getByRole('button', { name: 'Search spots', exact: true })
    const searchTriggerHandle = await searchTrigger.elementHandle()
    assert.ok(searchTriggerHandle)
    await searchTrigger.click()
    const searchInput = page.getByRole('textbox', { name: 'Search events, spots, and guides' })
    await searchInput.waitFor({ state: 'visible' })
    const searchInputHandle = await searchInput.elementHandle()
    assert.ok(searchInputHandle)
    await page.waitForFunction((input) => document.activeElement === input, searchInputHandle)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForFunction((trigger) => document.activeElement === trigger, searchTriggerHandle)

    const plannedTitle = await addFirstSpotToPlan(page)
    await openTab(page, 'Profile')
    await page.getByRole('navigation', { name: 'Your stuff' })
      .getByRole('button', { name: /^My Plans/ }).click()
    const plannedDay = page.locator('button.pf-dayh-tap').filter({ hasText: plannedTitle }).first()
    await plannedDay.waitFor({ state: 'visible' })
    await plannedDay.click()
    await page.getByRole('heading', { name: 'Plan Your Day', exact: true }).waitFor({ state: 'visible' })

    const optionsTrigger = page.getByRole('button', { name: `Options for ${plannedTitle}`, exact: true })
    const optionsTriggerHandle = await optionsTrigger.elementHandle()
    assert.ok(optionsTriggerHandle)
    await optionsTrigger.click()
    const modal = page.getByRole('dialog', { name: 'Plan item options' })
    await modal.waitFor({ state: 'visible' })
    assert.equal(await page.locator('.dpg-content').getAttribute('inert'), '')
    assert.equal(await page.locator('.dpg-content').getAttribute('aria-hidden'), 'true')
    const focusables = modal.locator('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
    const first = focusables.first()
    const last = focusables.last()
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-modal-initial-focus'))
    await page.keyboard.press('Shift+Tab')
    assert.equal(await last.evaluate((node) => document.activeElement === node), true, 'Shift+Tab must wrap first to last')
    await page.keyboard.press('Tab')
    assert.equal(await first.evaluate((node) => document.activeElement === node), true, 'Tab must wrap last to first')
    await assertNoNestedInteractiveControls(page, 'open plan modal')
    await assertNoSeriousAxeViolations(page, 'open plan modal')
    await page.keyboard.press('Escape')
    await modal.waitFor({ state: 'hidden' })
    await page.waitForFunction((trigger) => document.activeElement === trigger, optionsTriggerHandle)

    // Action closes differ from dismissal: move/remove replace the control that
    // launched the modal. Both paths must land on the meaningful control React
    // committed for the resulting slot, including reduced motion's immediate
    // unmount path used by this browser context. Picker add forwards the same
    // primitive and has an explicit structural contract in s10-modal-sheet.
    await optionsTrigger.click()
    const actionModal = page.getByRole('dialog', { name: 'Plan item options' })
    await actionModal.getByRole('button', { name: 'Move to a different time', exact: true }).click()
    const moveTarget = actionModal.locator('button.dpg-menu-item:not([disabled])').first()
    await moveTarget.waitFor({ state: 'visible' })
    const moveLabel = (await moveTarget.textContent())?.toLowerCase() || ''
    const targetSlotIndex = moveLabel.includes('morning')
      ? 0
      : moveLabel.includes('afternoon')
        ? 1
        : moveLabel.includes('night')
          ? 2
          : -1
    assert.ok(targetSlotIndex >= 0, `unexpected move target: ${moveLabel}`)
    await moveTarget.click()
    await actionModal.waitFor({ state: 'hidden' })

    const targetSlot = page.locator('.dpg-slot').nth(targetSlotIndex)
    const movedOptions = targetSlot.locator('button.dpg-more')
    await movedOptions.waitFor({ state: 'visible' })
    const movedOptionsHandle = await movedOptions.elementHandle()
    assert.ok(movedOptionsHandle)
    await page.waitForFunction((target) => document.activeElement === target, movedOptionsHandle)

    await movedOptions.click()
    await actionModal.getByRole('button', { name: 'Remove from plan', exact: true }).click()
    await actionModal.waitFor({ state: 'hidden' })
    const emptiedSlot = targetSlot.locator('button.dpg-empty')
    await emptiedSlot.waitFor({ state: 'visible' })
    const emptiedSlotHandle = await emptiedSlot.elementHandle()
    assert.ok(emptiedSlotHandle)
    await page.waitForFunction((target) => document.activeElement === target, emptiedSlotHandle)

    assert.deepEqual(rejectedImages, [], `unapproved image requests: ${rejectedImages.join('\n')}`)
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`)
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('\n')}`)
    await context.close()
  } finally {
    await browser?.close()
    await server?.close()
    await fixture?.cleanup()
  }
})

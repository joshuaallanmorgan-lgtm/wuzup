// AttributionPage — Settings → "Data & photo credits" (Stage E, the ⚑X3
// ship-gate page; ROADMAP §1: "sources disclosed" is part of the honesty
// contract, and this page is that promise rendered).
//
// EVERYTHING here is DERIVED AT RENDER TIME from the data the app actually
// shipped — the distinct event source families in the loaded events, the
// place sources + photo credits in places.json, the hero credits in the city
// config — so the page can never drift from reality the way a hand-maintained
// list would. The only prose lines are the license obligations themselves
// (OSM ODbL, Open-Meteo CC BY) and the art-floor promise, which are
// config-level facts, not data counts.
//
// Mounted in App's .subpage slot ({type:'attribution'}); Escape + the
// hardware back button ride the nav page layer automatically (WS2).
// ALL COPY IS DRAFT ⚑ Charles.
import { useMemo, useState } from 'react'
import { CITY, fmtLocale, Icon, sourceFamily } from './lib.js'
import { usePlaces } from './places.js'
import { useNav } from './nav.jsx'
import './attribution.css'

const fmtN = (n) => n.toLocaleString(fmtLocale)

// license → display family: Mapillary street-level photos are split out first
// (their obligation names the platform), then the Creative Commons families.
// Test order matters: 'CC BY-SA 4.0'.startsWith('CC BY') is true too.
function licenseFamily(credit) {
  if (credit.sourceFamily === 'mapillary-sign') return 'Mapillary · CC BY-SA'
  const l = credit.license || ''
  if (l.startsWith('CC BY-SA')) return 'CC BY-SA'
  if (l.startsWith('CC BY')) return 'CC BY'
  if (l === 'CC0' || l === 'Public domain') return 'CC0 / Public domain'
  return l || 'Unlicensed' // never expected — every shipped photo carries a license
}

// count occurrences into sorted [name, n] pairs (desc, ties alphabetical)
function tally(names) {
  const m = new Map()
  for (const name of names) m.set(name, (m.get(name) || 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export default function AttributionPage({ events }) {
  // opened ONLY from Settings (the About row): the visible back affordance
  // reopens Settings (the InterestEditor settings-origin idiom) so the trio
  // reads as layers; hardware/browser back + Escape ride the nav page layer
  // (WS2 single-entry REPLACE: they close to the tab, the accepted contract).
  const { openSettings: onClose } = useNav()
  // the places layer (same lazy /places.json fetch the Spots tab uses) — this
  // page exists to disclose that data, so it pays the fetch on open.
  const { places, status } = usePlaces()
  const [creditsOpen, setCreditsOpen] = useState(false)

  // (a) EVENT sources — the distinct source FAMILIES actually present in the
  // loaded events (added-by-you entries are the user's, not a source).
  const evList = useMemo(() => events.filter((e) => !e.tags?.includes('added-by-you')), [events])
  const evFamilies = useMemo(() => tally(evList.map(sourceFamily)), [evList])

  // (b) PLACE sources — the distinct names in the shipped places' sources[]
  // (one place can be corroborated by several, so counts overlap by design).
  const placeSources = useMemo(
    () => tally((places || []).flatMap((p) => (Array.isArray(p.sources) ? p.sources : []))),
    [places]
  )

  // (c) PHOTO credits — every shipped place photo carries imageCredit
  // {author, license, licenseUrl, url, sourceFamily}; aggregate by license
  // family + keep the full per-photographer ledger for the expandable list.
  const photoCredits = useMemo(
    () =>
      (places || [])
        .filter((p) => p.image && p.imageCredit)
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [places]
  )
  const photoFamilies = useMemo(() => tally(photoCredits.map((p) => licenseFamily(p.imageCredit))), [photoCredits])

  // the city HERO credits (city.js: hand-picked Commons photos whose credits
  // live in the config, not the finder ledger — rendered explicitly here).
  const heroCredits = [
    ...(CITY.heroes || []).map((h) => ({ ...h, label: 'Home hero' })),
    ...(CITY.spotsHeroes || []).map((h) => ({ ...h, label: 'Spots hero' })),
  ]

  return (
    <div className="pg at">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Data &amp; Photo Credits</h1>
      </header>

      <div className="at-body">
        <p className="at-intro">
          Everything in Wuzup {CITY.name} comes from real, public sources — and every one of them is
          named below. Nothing here is hand-typed: this page reads the same data the app runs on.
        </p>

        {/* ===== (a) EVENT LISTINGS — derived from the loaded events ===== */}
        <section className="at-sec">
          <div className="at-over">Event listings</div>
          <div className="at-card">
            <div className="at-line">
              <span className="num">{fmtN(evList.length)}</span> events from{' '}
              <span className="num">{evFamilies.length}</span> local source{evFamilies.length === 1 ? '' : 's'}
            </div>
            <div className="at-rows">
              {evFamilies.map(([name, n]) => (
                <div className="at-row" key={name}>
                  <span className="at-row-name">{name}</span>
                  <span className="at-row-n num">{fmtN(n)}</span>
                </div>
              ))}
            </div>
            <div className="at-note">
              Counted by each event’s primary source. Every listing links out to its original page —
              the source stays the source.
            </div>
          </div>
        </section>

        {/* ===== (b) PLACE DATA — ODbL obligation + the derived source names ===== */}
        <section className="at-sec">
          <div className="at-over">Place data</div>
          <div className="at-card">
            <div className="at-line">
              Map data ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap contributors
              </a>
              , under the{' '}
              <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noreferrer">
                Open Database License
              </a>
            </div>
            {status === 'ready' && places && places.length > 0 && (
              <>
                <div className="at-line at-dim">
                  <span className="num">{fmtN(places.length)}</span> spots, drawn from{' '}
                  <span className="num">{placeSources.length}</span> public datasets
                </div>
                <div className="at-rows">
                  {placeSources.map(([name, n]) => (
                    <div className="at-row" key={name}>
                      <span className="at-row-name">{name}</span>
                      <span className="at-row-n num">{fmtN(n)}</span>
                    </div>
                  ))}
                </div>
                <div className="at-note">
                  Sources overlap on purpose — one park is often corroborated by several datasets.
                  Government data is Florida public records, credited to each agency by name.
                </div>
              </>
            )}
            {status === 'loading' && <div className="at-line at-dim">Loading place data…</div>}
            {status === 'error' && (
              <div className="at-line at-dim">Couldn’t load place data — the dataset credits appear once it loads.</div>
            )}
          </div>
        </section>

        {/* ===== (c) PHOTOGRAPHY — real credits from the shipped data + the
                   city hero credits from the config ===== */}
        <section className="at-sec">
          <div className="at-over">Photography</div>
          <div className="at-card">
            {status === 'ready' && (
              <>
                <div className="at-line">
                  <span className="num">{fmtN(photoCredits.length)}</span> place photos — every one a real
                  photo of the place itself
                </div>
                <div className="at-rows">
                  {photoFamilies.map(([name, n]) => (
                    <div className="at-row" key={name}>
                      <span className="at-row-name">{name}</span>
                      <span className="at-row-n num">{fmtN(n)}</span>
                    </div>
                  ))}
                </div>
                {photoCredits.length > 0 && (
                  <>
                    <button
                      className={'at-expand' + (creditsOpen ? ' open' : '')}
                      onClick={() => setCreditsOpen((v) => !v)}
                      aria-expanded={creditsOpen}
                    >
                      <span>
                        {creditsOpen ? 'Hide' : 'All'} <span className="num">{fmtN(photoCredits.length)}</span>{' '}
                        photographer credits
                      </span>
                      <Icon.chevron className="at-expand-chev" width={16} height={16} aria-hidden />
                    </button>
                    {creditsOpen && (
                      <ul className="at-photos">
                        {photoCredits.map((p) => {
                          const c = p.imageCredit
                          return (
                            <li className="at-ph" key={p.key}>
                              <span className="at-ph-place">{p.title}</span>
                              <span className="at-ph-by">
                                <a href={c.url} target="_blank" rel="noreferrer">
                                  {c.author}
                                </a>
                                {' · '}
                                {c.licenseUrl ? (
                                  <a href={c.licenseUrl} target="_blank" rel="noreferrer">
                                    {c.license}
                                  </a>
                                ) : (
                                  c.license
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </>
                )}
              </>
            )}
            {status === 'loading' && <div className="at-line at-dim">Loading photo credits…</div>}
            {status === 'error' && (
              <div className="at-line at-dim">Couldn’t load photo credits — they appear once the place data loads.</div>
            )}
            {/* the city heroes are config-carried credits (never in the finder
                ledger) — disclosed explicitly, same duty as the per-place photos */}
            {heroCredits.length > 0 && (
              <div className="at-heroes">
                {heroCredits.map((h) => (
                  <div className="at-ph" key={h.url}>
                    <span className="at-ph-place">
                      {CITY.name} · {h.label}
                    </span>
                    <span className="at-ph-by">
                      {h.page ? (
                        <a href={h.page} target="_blank" rel="noreferrer">
                          {h.credit}
                        </a>
                      ) : (
                        h.credit
                      )}
                      {' · '}
                      {h.licenseUrl ? (
                        <a href={h.licenseUrl} target="_blank" rel="noreferrer">
                          {h.license}
                        </a>
                      ) : (
                        h.license
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ===== (d) WEATHER ===== */}
        <section className="at-sec">
          <div className="at-over">Weather</div>
          <div className="at-card">
            <div className="at-line">
              Forecasts by{' '}
              <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                Open-Meteo
              </a>
              , under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
                CC BY 4.0
              </a>
            </div>
          </div>
        </section>

        {/* ===== (e) the app's own floor — the contract, stated to users ===== */}
        <section className="at-sec">
          <div className="at-over">When there’s no photo</div>
          <div className="at-card">
            <div className="at-line at-dim">
              Spots without a verified photo show generated artwork — an abstract color field derived
              from the place itself, clearly art. We never dress a stock photo up as the real thing.
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

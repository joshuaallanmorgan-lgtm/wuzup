# Sprint 12 operations decision packet

> **Status:** evidence-backed recommendation for owner ratification; no source, hosting, spend, pilot, or legal decision is activated
>
> **Checked:** 2026-07-22 against the linked first-party policies and pricing pages
>
> **Authority:** subordinate to `V2_PLAN.md`, `V2_SPRINTS.md`, source-specific terms, and the owner's explicit ruling

## Recommendation in one page

1. Keep GitHub Pages only through a noncommercial controlled two-city beta, and only after Sprint 11's production
   freshness, source-policy, exact-deploy, and observation gates pass. Do not treat it as the V2 GA host: GitHub says
   Pages is not intended or allowed as free hosting for commercial SaaS, recommends 1 GB source/site ceilings, and
   applies a 100 GB/month soft bandwidth limit.
2. Treat one Cloudflare Pages shell plus R2 Standard as the **preferred pilot candidate pending a disposable hosting
   spike**, not as a selected host. The spike must settle private access, same-origin versus CORS loading, the artifact
   trust root, caching, takedown/retention, rollback, and whether Access, a Worker, or another gateway is required.
3. Propose daily verified event acquisition, weekly verified place acquisition, and manifest/index-last publication.
   Integrity refusal, stale/health demotion, launch admission, and human-audit failure remain separate states; none is
   approved until the owner ratifies the cadence and state machine. The launch-gate draft proposes an exact,
   deterministic weekly sample of at least 50 decision-ready rows per city; that floor and method are not yet policy.
4. Approve only sources with an explicit compatible API/feed/data license. Permission is separate from source health.
   Do not scale current page-reading adapters, and do not grandfather their Tampa/SF use into a public or commercial
   beta. The current scheduled Nominatim pace must also be corrected before the first verified refresh bootstrap.
5. Treat Census Places/CBSA as a reproducible **name/centroid seed only**. A full-US resolver still needs ratified input
   semantics and boundary/reverse-resolution evidence. OSM extracts/provider data require an explicit ODbL ruling;
   public Overpass remains bounded private-evaluation infrastructure, not a national service plan.
6. Treat Ticketmaster Discovery as a blocked private-eval candidate. Scheduled bulk acquisition, commercial use,
   paging/quota, privacy disclosure, bounded retention, 24-hour removals, CDN purges, and old immutable generations all
   require written/provider-compatible and owner/legal evidence before admission.
7. Use **$10/month infrastructure** and **30 minutes per city per week** only as unvalidated pilot hypotheses. Sprint 12
   must ratify a total operating budget that also records domains, CI/storage, monitoring, source/API licenses, incident
   work, and human review. No alert is a hard cap and no proposed number is consent.

## Hosting evidence and posture

| Option | Current first-party evidence | V2 posture |
|---|---|---|
| GitHub Pages | [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) describe a 1 GB recommended source/site ceiling, 100 GB/month soft bandwidth, 10-minute deployments, and a restriction against using Pages as free commercial SaaS hosting. | Keep for the noncommercial controlled two-city beta only. Migrate before a commercial/public nationwide product. |
| GitHub Actions | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) says standard hosted runners are free for public repositories. | Candidate deterministic control plane while the repository remains public and policy-compatible. A measured 5-10-market spike must prove wall time, isolation, fan-in, retention, and cost; the current serial two-city workflow is not that proof. |
| Cloudflare Pages | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) allow 500 builds/month and 20,000 files on Free; [static asset requests are free and unlimited](https://developers.cloudflare.com/pages/functions/pricing/). | Preferred shell candidate only. Use one project rather than one per city if the spike preserves private proof and the exact-release contract. |
| Cloudflare R2 Standard | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) includes 10 GB-month, 1 million Class A operations, and 10 million Class B operations monthly on Standard; additional storage is $0.015/GB-month, Class A is $4.50/million, Class B is $0.36/million, and direct egress is free. [Custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/) permit cache and security controls, but only selected types cache by default. | Preferred artifact/image-store candidate only. A public bucket is not a private pilot. Use content-addressed objects behind ratified access controls, configure cache rules deliberately, and keep `r2.dev` out of production. |
| Cloudflare Workers / Access | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) includes a Free tier of 100,000 requests/day with 10 ms CPU per invocation; paid Standard starts at $5/month with 10 million requests. R2 [access controls](https://developers.cloudflare.com/r2/buckets/public-buckets/#access-control) include Cloudflare Access/WAF options. | Decide after the spike. Do not assume a Worker is required or unnecessary until private access, routing, headers, and origin policy are proven. |

The hosting spike must pass all of these before ratification:

- private-market artifacts remain unpublished or are protected by verified access control; obscurity is not privacy;
- the current root-relative/same-release contract is deliberately migrated to a validated same-origin path or exact
  allowlisted CORS/CSP scheme; [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) is mandatory for a
  browser reading a separate artifact origin;
- the tested shell pins the exact cities-index/site release or verifies a signed index against a pinned public key;
  a self-hash alone is not authorization;
- CI uses least-privilege credentials, creates immutable objects conditionally, publishes only exact tested hashes,
  flips the index last, and runs participant-facing observation; forged index, stale-cache, interruption, unauthorized
  replacement, and rollback fixtures fail closed; and
- immutable packs, mutable pointers, cache headers/purges, provider takedowns, retained versions, request costs, and
  a 5-10-market refresh/load receipt all have explicit policies.

Before any Cloudflare activation, the owner must approve the account, domain/DNS control, billing, retention,
rollback owner, and secret handling. [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
are available to pay-as-you-go accounts, are account-wide, and notify without pausing or capping usage. Configure them
immediately after enabling pay-as-you-go and before uploads or participant traffic; $10 and $25 remain proposed only.

## National-source posture

| Source or family | First-party evidence | Proposed ruling |
|---|---|---|
| U.S. Census gazetteers | The [Census Gazetteer page](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) provides national places, CBSA, county, state, urban-area, and ZCTA files with identifiers and representative coordinates for the 50 states and DC. | Candidate pinned annual **name/centroid seed only**, with byte hash, release year, parser fixture, and replacement review. It does not by itself resolve arbitrary addresses, coordinates, rural/unincorporated areas, border ambiguity, or authoritative containment. |
| Public Nominatim | The [usage policy](https://operations.osmfoundation.org/policies/nominatim/) caps ordinary use at one request/second, restricts recurring jobs to four requests/minute, requires caching/identification, and forbids systematic POI or grid queries. | **Current scheduled-refresh blocker as well as a scale blocker.** Until replaced, verified scheduled refreshes must be cache-only or use one identified thread with at least 15 seconds between every attempt, including retries, plus durable caching. Prove bootstrap compliance; do not use it for national generation or client autocomplete. |
| OSM data and extracts | The official [OSM copyright and license page](https://www.openstreetmap.org/copyright) identifies OSM data as ODbL and requires attribution and license notice, with share-alike obligations for adapted databases. | Candidate only after an owner/legal ODbL decision covers attribution, derivative-database/share-alike or offer obligations, source snapshot/date, provider terms, and an artifact-level compliance test. Provider approval does not settle the data license. |
| Public Overpass | The [Overpass API guidance](https://wiki.openstreetmap.org/wiki/Overpass_API) describes below 10,000 queries and 1 GB downloaded per day as safe for its named main instance; capacity and policy remain endpoint-specific. | **Bounded private evaluation only**, with one identified sequential client, cache, source receipts, and retry ceilings. Select and ratify an extract/provider/self-host posture before national generation; a service failure cannot itself authorize product demotion. |
| OSM tiles | The [tile policy](https://operations.osmfoundation.org/policies/tiles/) forbids bulk/offline prefetch and offers no SLA. | Wuzup currently has no map product. **Do not add tile fetching** as part of V2 location coverage. |
| Ticketmaster Discovery | The [Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) requires a key, defaults to 5,000 calls/day and 5 requests/second, and limits deep paging to 1,000 items. Its [terms](https://developer.ticketmaster.com/support/terms-of-use/) restrict caching to reasonable periods, require removals, restrict revenue/API resale, and prohibit replacing Ticketmaster's essential experience. | **Blocked private-eval candidate.** Before any scheduled/bulk or commercial use, require written compatibility, a quota/partition plan, privacy policy, branded source links, bounded retention, and a tested 24-hour removal path through active packs, CDN caches, and retained immutable generations. Old public immutable copies are not acceptable retention. |
| Meetup pages | Meetup's [2026 Terms of Service](https://www.meetup.com/terms/) prohibit extracting platform data for an unpermitted commercial purpose through automated scraping. | **No new expansion and no grandfathering.** Current flagship use also needs an owner/legal decision before a public or commercial beta; otherwise remove/replace it, rebaseline without it, or document a strictly noncommercial research posture and end date. |
| Eventbrite and AllEvents pages | Current first-party terms could not be reproducibly fetched during this review; Eventbrite returned HTTP 429 and the AllEvents terms route did not expose a stable terms document. | **Unverified and blocked, including current flagship use in a public or commercial beta.** Remove/replace and rebaseline, obtain written/API permission, or document a strictly noncommercial research posture and end date. Existing adapters are not precedent. |
| Google Places | [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) generally prohibit prefetching/caching/storing Places content beyond exceptions and impose product/author attribution. | **Reject as the static Wuzup corpus backbone.** A later runtime use would need a separately designed, billed, attributed product path. |
| Wikimedia Commons | Wikimedia's full [Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) and Commons [reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) require checking each work's license and satisfying applicable attribution/share-alike obligations. | Per-image candidate only after owner policy ratification and an exact license, author, source-page, byte-hash, identity, and attribution receipt. No host-wide inference. |
| Mapillary | Current terms/API pages require an authenticated review and were not reproducibly available to this audit. | Existing receipts are evidence, not permission or grandfathering. Until the owner ratifies API terms, commercial use, self-host/download/crop, privacy, attribution, storage, and takedown handling, unresolved rows remain Aurora and no new batch ships. |

Permission, technical availability, and source health are separate gates. This packet is operational/product evidence,
not legal advice. Ambiguous or unavailable terms mean blocked, not allowed.

## Proposed cadence and failure-state contract

| Tier | Events | Place facts | Imagery | Failure behavior |
|---|---|---|---|---|
| Flagship | Proposed daily verified acquisition; proposed 48-hour event max age | Proposed weekly and manual before launch/recovery | Supervised additions; verify every retained local byte on publication | Failed required-source health or freshness removes discovery recommendations. Last-good rows may remain only in saved/planned retained value, visibly stale and separately verified. |
| Private pilot metro | Proposed daily verified acquisition | Proposed weekly | Commons/government/operator receipts plus Aurora; no Mapillary dependency | Limited state is allowed only through the ratified state machine after separate health/freshness verification. Integrity-invalid packs never render. |
| Nationwide floor | No public event pack until an approved national source proves sustainable | Ratified versioned OSM extract/provider cadence plus proposed annual Census seed | Aurora by default; verified licensed additions only | Thin/not-covered is the normal safe state; never borrow a neighboring city's claims or rows. |

The owner must ratify distinct transitions and recovery evidence:

- **Integrity, hash, signature, schema, or artifact-identity failure:** refuse publication and leave the prior cities
  index byte-identical. Never display or demote through an invalid pack.
- **Freshness or continuous required-source-health failure:** use a separately verified limited state. Remove discovery
  recommendations; preserve last-good rows only as visibly stale saved/planned value when that use remains permitted.
- **Launch-gate or human-audit failure:** block admission, or require an explicit owner-reviewed demotion with a recorded
  reason, expiry, recovery owner, and re-admission evidence.
- **Generation, upload, or observation failure:** abandon the candidate generation. It never deletes or rewrites the
  prior pointer and never creates a mixed release.

Publication order is city shards -> city manifest -> cities index. Only an observed, exact-tested candidate may flip
the index; failure leaves the prior index and participant-visible release unchanged.

## Pilot cohort decision frame

Do not select markets solely by population or source abundance. Freeze 5-10 candidates only after each row has:

- a distinct regime label: inland, coastal, small metro, micropolitan, data-poor, multi-timezone edge, or sparse source;
- a ratified supported-input contract for locality name, ZIP, coordinate, and/or street address; Census name/centroid
  seeding is not a containment or reverse-geocoding contract;
- timezone, authoritative boundary/containment and reverse-resolution evidence, candidate source roster, and expected
  cadence, including rural, unincorporated, border, Alaska/Hawaii, and timezone-edge fixtures;
- estimated raw/gzip bytes, refresh duration, requests, human review minutes, and monthly hosting/source cost;
- explicit source terms status (`approved`, `needs-owner`, or `blocked`);
- a rollback owner and ratified demotion/re-admission threshold; and
- an unpublished or access-controlled private build that either passes the ratified launch gate or renders a truthful
  limited state.

Tampa Bay and SF/East Bay remain the flagship controls, not two of the new pilot markets. Candidate names remain open
until the source and hosting rulings above are explicit; choosing names first would silently turn blocked sources into
requirements.

## Owner ratification block

The owner should record one value for each line before any provider-dependent Sprint 13 implementation, account/key or
source acquisition, cohort freeze, private artifact upload, or participant publication:

| Decision | Recommended default | Owner ruling |
|---|---|---|
| Two-city beta host | Keep GitHub Pages temporarily | pending |
| Pilot host spike result | No provider selection until the disposable spike produces an acceptance receipt | pending |
| Private access and trust root | Access-controlled/unpublished artifacts; shell pins exact index/release or verifies a signed index | pending |
| Total pilot operating budget | Record domains, CI/storage, monitoring, provider/API licenses, incident work, and human review | pending |
| Pilot infrastructure alerts | If pay-as-you-go is enabled, notify at proposed $10/$25; alerts are not caps | pending |
| Owner-ops ceiling | 30 minutes/city/week | pending |
| City launch-gate contract | Pin an approved gate version/hash and its evidence schema | pending |
| Launch-gate evidence authority | Same trusted CI process derives artifact/source/selection receipts and invokes the observed two-city consumer; self-hashes alone are not authentication | pending |
| Weekly human sample | Proposed minimum 50 rows per city, selected by the gate's deterministic population-bound algorithm | pending |
| Event refresh and max age | Proposed daily acquisition and 48-hour max age | pending |
| Place-fact refresh | Proposed weekly acquisition plus manual launch/recovery review | pending |
| Source-health contract | Identify required versus supplemental sources, thresholds, evidence, and recovery | pending |
| Failure/demotion/rollback state machine | Ratify the four failure classes above, recovery evidence, owners, and re-admission | pending |
| Runtime location inputs | Ratify supported inputs plus boundary, containment, reverse-resolution, border, and timezone behavior | pending |
| National gazetteer seed | Pinned annual Census Places + CBSA as name/centroid seed only | pending |
| OSM data license | Ratify attribution, ODbL derivative/share-alike or offer duties, snapshot/date, and artifact test | pending |
| National OSM acquisition | Extract/provider for scale; public Overpass only for bounded private evaluation | pending |
| Ticketmaster | Blocked private eval until bulk/commercial, paging, privacy, retention, and removal gates pass | pending |
| Meetup/Eventbrite/AllEvents page reads | No current public/commercial beta or expansion without permission or a bounded research ruling | pending |
| Google Places | Not a static corpus source | pending |
| Wikimedia | Per-item policy and exact license/author/source/hash/attribution receipts | pending |
| Mapillary | Aurora until terms, commercial, storage/crop, privacy, attribution, and takedown ruling | pending |
| Pilot cohort | 5-10 evidence-complete diverse markets after source ruling | pending |
| Pilot expansion go/no-go | No expansion until two refresh/rollback cycles and the full release gate pass | pending |

No `pending` value may be interpreted as consent, launch approval, or a waiver of a failing gate.

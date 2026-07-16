import { readFileSync } from 'node:fs'

import { createCreativeLoafingParser } from '../../../finder/render.mjs'

const fixture = JSON.parse(readFileSync(new URL('./sources/cltampa-card.json', import.meta.url), 'utf8'))
const nowMs = Date.parse(process.env.RENDER_NOW || '2027-01-01T02:30:00Z')
const parseCard = createCreativeLoafingParser({ nowMs })

console.log(JSON.stringify(parseCard(fixture.cardText, fixture.title)))

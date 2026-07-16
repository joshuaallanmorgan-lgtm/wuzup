import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const sourceRoot = fileURLToPath(new URL('../finder/sources/', import.meta.url))
const cityDirectories = ['tampa-bay', 'sf-east-bay']

function adapterFiles() {
  return cityDirectories.flatMap((cityId) => readdirSync(`${sourceRoot}/${cityId}`, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.startsWith('_'))
    .map((entry) => ({ cityId, name: entry.name, path: `${sourceRoot}/${cityId}/${entry.name}` })))
}

test('every live city adapter exposes one injectable run-clock boundary', () => {
  const adapters = adapterFiles()
  assert.equal(adapters.length, 17, 'unexpected live adapter inventory; update the ratchet deliberately')

  for (const adapter of adapters) {
    const source = readFileSync(adapter.path, 'utf8')
    assert.match(
      source,
      /export async function fetchEvents\(options = \{\}\)/,
      `${adapter.cityId}/${adapter.name} must accept the finder options contract`,
    )
    assert.match(
      source,
      /const nowMs = (?:config|options\??)\.nowMs \?\? Date\.now\(\)/,
      `${adapter.cityId}/${adapter.name} must capture exactly one fallback run epoch`,
    )
  }
})

test('live adapters cannot reintroduce host-local product calendar math', () => {
  const forbidden = [
    [/new Date\s*\(\s*\)/, 'ambient new Date()'],
    [/\.(?:getFullYear|getMonth|getDate|getDay|getHours|setDate)\s*\(/, 'host-local Date getter/setter'],
    [/new Date\s*\([^\n)]*,[^\n)]*\)/, 'multi-argument host-local Date construction'],
    [/new Intl\.DateTimeFormat/, 'adapter-local Intl calendar projection'],
    [/Date\.UTC\s*\(/, 'adapter-local UTC calendar arithmetic'],
    [/\bdayInTz\s*\(\s*[^,\n)]+\)/, 'dayInTz without an explicit instant'],
    [/\boffsetInTz\s*\(\s*[^,\n)]+\)/, 'offsetInTz without an explicit instant'],
    [/["']America\/(?:New_York|Los_Angeles)["']/, 'hardcoded city timezone'],
  ]

  for (const adapter of adapterFiles()) {
    const source = readFileSync(adapter.path, 'utf8')
    const executable = source
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    for (const [pattern, label] of forbidden) {
      assert.doesNotMatch(executable, pattern, `${adapter.cityId}/${adapter.name}: ${label}`)
    }
  }
})

test('shared city helpers require explicit instants instead of consulting the wall clock', () => {
  const source = readFileSync(`${sourceRoot}/_shared.mjs`, 'utf8')
  assert.match(source, /export function dayInTz\(tz, instant\)/)
  assert.match(source, /export function offsetInTz\(tz, instant\)/)
  assert.doesNotMatch(source, /instant\s*=\s*new Date\(\)/)
})

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const probe = fileURLToPath(new URL('./fixtures/city-time/day-key-migration-probe.mjs', import.meta.url))

test('legacy device-midnight plan keys migrate losslessly to city days in every device timezone', () => {
  const zones = ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo']
  const outputs = zones.map((TZ) => {
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8',
      env: { ...process.env, TZ },
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  })
  const stable = outputs.map((output) => {
    const copy = structuredClone(output)
    copy.first.receipt.sourceDeviceTimeZone = 'device-zone'
    copy.first.basis.sourceDeviceTimeZone = 'device-zone'
    copy.partial.afterRetry.receipt.sourceDeviceTimeZone = 'device-zone'
    return copy
  })
  assert.deepEqual(stable[1], stable[0])
  assert.deepEqual(stable[2], stable[0])
  outputs.forEach((output, index) => assert.equal(output.first.receipt.sourceDeviceTimeZone, zones[index]))

  const { first, second } = outputs[0]
  const dayKey = String(first.expectedDay)
  const singletonKey = String(first.expectedSingleton)
  assert.deepEqual(Object.keys(first.plans), [dayKey, singletonKey])
  assert.deepEqual(first.plans[dayKey].slots, {
    morning: null,
    afternoon: 'e|canonical',
    night: 'e|legacy',
  })
  assert.deepEqual(first.plans[singletonKey].slots, {
    morning: null,
    afternoon: 'e|singleton',
    night: null,
  })
  assert.equal(first.history.length, 1)
  assert.deepEqual(first.history[0].slots, {
    morning: null,
    afternoon: 'e|history-canonical',
    night: 'e|history-legacy',
  })
  assert.deepEqual(first.converted, { v: 1, [dayKey]: 'went' })
  assert.equal(first.weekend.weekendStartTs, first.expectedFriday)
  assert.equal(first.weekendDone.weekendStartTs, first.expectedFriday)
  assert.deepEqual(first.receipt, {
    v: 1,
    cityId: 'tampa-bay',
    timeZone: 'America/New_York',
    sourceDeviceTimeZone: 'America/Los_Angeles',
  })
  assert.equal(first.canonicalStable, first.expectedDay)
  assert.deepEqual(first.basis, first.receipt)
  assert.deepEqual(second, {
    plans: first.plans,
    history: first.history,
    converted: first.converted,
    weekend: first.weekend,
    weekendDone: first.weekendDone,
  })
  const retryKey = String(outputs[0].partial.cityRetryDay)
  assert.equal(outputs[0].partial.afterFailure.receipt, null)
  assert.equal(outputs[0].partial.afterFailure.plans[retryKey].slots.night, 'e|retry')
  assert.equal(outputs[0].partial.afterRetry.plans[retryKey].slots.night, 'e|retry')
  assert.equal(outputs[0].partial.afterRetry.receipt.v, 1)
  assert.equal(outputs[0].partial.freshPlans[retryKey].slots.night, 'e|retry')
})
test('a persisted source-zone basis survives retry from a different device timezone', () => {
  const result = spawnSync(process.execPath, [probe], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'Asia/Tokyo', LEGACY_SOURCE_TZ: 'America/Los_Angeles' },
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.first.receipt.sourceDeviceTimeZone, 'America/Los_Angeles')
  assert.deepEqual(output.first.basis, output.first.receipt)
  assert.deepEqual(Object.keys(output.first.plans), [
    String(output.first.expectedDay),
    String(output.first.expectedSingleton),
  ])
  assert.equal(output.first.plans[String(output.first.expectedDay)].slots.afternoon, 'e|canonical')
  assert.equal(output.first.plans[String(output.first.expectedDay)].slots.night, 'e|legacy')
  assert.equal(output.first.plans[String(output.first.expectedSingleton)].slots.afternoon, 'e|singleton')
})

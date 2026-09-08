import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeRetentionSettings,
  MAX_RETENTION_HOURS,
  retentionInputToHours,
} from '../src/client/retention-settings.ts'

test('decodes valid retention settings and rejects malformed sections', () => {
  assert.deepEqual(decodeRetentionSettings({ retentionHours: 24 }), { retentionHours: 24 })
  assert.equal(decodeRetentionSettings({ retentionHours: 0 }), undefined)
  assert.equal(decodeRetentionSettings({ retentionHours: 1.5 }), undefined)
  assert.equal(decodeRetentionSettings({ retentionHours: MAX_RETENTION_HOURS + 1 }), undefined)
  assert.equal(decodeRetentionSettings([]), undefined)
})

test('converts custom hour and day inputs without accepting fractions or overflow', () => {
  assert.equal(retentionInputToHours('36', 'hours'), 36)
  assert.equal(retentionInputToHours('3', 'days'), 72)
  assert.equal(retentionInputToHours(' 7 ', 'days'), 168)
  assert.equal(retentionInputToHours('1.5', 'days'), undefined)
  assert.equal(retentionInputToHours('0', 'hours'), undefined)
  assert.equal(retentionInputToHours(String(MAX_RETENTION_HOURS), 'days'), undefined)
})

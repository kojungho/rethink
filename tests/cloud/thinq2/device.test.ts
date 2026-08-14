import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { timeSyncPayload } from '@/cloud/thinq2/device'

describe('ThinQ2 time synchronization', () => {
    test('encodes a one-based month in the appliance timezone', () => {
        const result = timeSyncPayload(new Date('2026-08-14T23:59:58Z'), '+0900')
        assert.deepEqual([...result], [26, 8, 15, 8, 59, 58, 6])
    })
})

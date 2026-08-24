import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/WTL_KPK_BDH_KR_01'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-korean-washtower'
const META: Metadata = {
    modelId: 'WTL_KPK_BDH_KR_01',
    modelName: 'WTL_KPK_BDH_KR_01',
    swVersion: '3.0.26',
    deviceType: '223',
}

// Captured from the user's Korean WashTower after the inherited F0ED full-state query.
// Header 36 0a, message type 0x78, tag 0xeb, state length 0x0066 (102 bytes).
const KOREAN_FULL_STATE =
    'aaff360a0078000106000100eb0066013900000000002e00000000000000000000000000002e000100000000002b0402022d3c00000000000430000000000000040000000000000000002a000000000000000000000000000001000000000000000000000000000700000000000000000000000000ec91bb'

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe('WTL_KPK_BDH_KR_01', () => {
    test('decodes the captured 102-byte Korean full-state response', () => {
        const { ha, thinq } = makeDevice()
        const mapped: boolean[] = []
        thinq.on('packetData', (_packet, isMapped) => mapped.push(isMapped))

        thinq.receivePacket(buf(KOREAN_FULL_STATE))

        const properties = ha.devices[DEVICE_ID].properties
        assert.equal(properties['washer/power'], 'OFF')
        assert.equal(properties['washer/state'], 'POWEROFF')
        assert.equal(properties['washer/course'], 'NORMAL')
        assert.equal(properties['washer/buzzer'], 'Very High')
        assert.equal(properties['washer/remaining_time'], 0)
        assert.equal(properties['dryer/power'], 'OFF')
        assert.equal(properties['dryer/state'], 'POWEROFF')
        assert.equal(properties['dryer/course'], 'NOT_SELECTED')
        assert.equal(properties['shared/init_lcd'], 'Default')
        assert.deepEqual(mapped, [true])
    })

    test('inherits the WashTower full-state query', () => {
        const { thinq, dev } = makeDevice()
        dev.start()
        assert.equal(hex(thinq.outbox.at(-1)!), 'AA0EF0ED1121010000001800B5BB')
    })

    test('rejects a truncated Korean state block', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf('aa11360a00780000000000eb00010000bb'))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/state'], undefined)
    })
})

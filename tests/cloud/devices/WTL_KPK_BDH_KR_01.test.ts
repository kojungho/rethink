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

const WASHER_POWER_OFF_STATUS =
    'aa7336e600020133010200013900000000002e00000000000000000000000000002e000100000000002b0402022d3c00000000000430000000000000040000000000000000002a00020200002e000000006e006e010000000000042e000000200000800700000000000000000000000000babb'
const WASHER_POWER_ON_STATUS =
    'aa7336e600020133010200013900030302062e00000000000000002100210001002e010000000000022b0402022d3c20000000000430000000000000040000000000000000002a00020200002e000000006e006e010000000000042e00000000000080070000000000000000000000000017bb'
const WASHER_POWER_ON_PAIR =
    'aaff360a00de00013f000100ec00cc013900000000002e00000000000000000000000000002e000100000000002b0402022d3c00000000000430000000000000040000000000000000002a00020200002e000000006e006e010000000000042e000000000000800700000000000000000000000000013900030302062e00000000000000002100210001002e010000000000022b0402022d3c20000000000430000000000000040000000000000000002a00020200002e000000006e006e010000000000042e000000000000800700000000000000000000000000a26cbb'
const WASHER_LAUNDRY_CARE_ON_STATUS =
    'aa7336e600020133015700013900030501062e000000000000000027002e007a002e0b2600010000012c0402022d3c200000100104340000000000000c0000000000000000002a000000000000000000000000000001000000000000000000000000000700000000000000000000000000e7bb'
const WASHER_LAUNDRY_CARE_OFF_STATUS =
    'aa7336e600020133015700013900030501062e000000000000000027002e008b002e0b2600010000012c0402022d3c20000010010434000000000000040000000000000000002a000000000000000000000000000001000000000000000000000000000700000000000000000000000000eebb'

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe('WTL_KPK_BDH_KR_01', () => {
    test('publishes the ThinQ cycle count as a cumulative Korean washer sensor', () => {
        const { ha } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>

        assert.equal(components.washer_cycle_count.platform, 'sensor')
        assert.equal(components.washer_cycle_count.name, '세탁기 누적 세탁 횟수')
        assert.equal(components.washer_cycle_count.state_class, 'total_increasing')
    })

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
        assert.equal(properties['washer/cycle_count'], 43)
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

    test('uses the command-status response as immediate power feedback', () => {
        const { ha, thinq } = makeDevice()

        thinq.emit('data', buf(WASHER_POWER_ON_STATUS))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/power'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['washer/state'], 'INITIAL')
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/power'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/state'], 'INITIAL')
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/course'], 'CLOTHCARE')
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/remaining_time'], 110)

        thinq.emit('data', buf(WASHER_POWER_OFF_STATUS))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/power'], 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties['washer/state'], 'POWEROFF')
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/power'], 'ON')
    })

    test('uses the current half of a 0xde previous/current state pair', () => {
        const { ha, thinq } = makeDevice()

        thinq.emit('data', buf(WASHER_POWER_ON_PAIR))

        assert.equal(ha.devices[DEVICE_ID].properties['washer/power'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['washer/state'], 'INITIAL')
        assert.equal(ha.devices[DEVICE_ID].properties['washer/remaining_time'], 33)
        assert.equal(ha.devices[DEVICE_ID].properties['washer/cycle_count'], 43)
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/power'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/state'], 'INITIAL')
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/remaining_time'], 110)
    })

    test('decodes laundry care feedback from captured Korean command-status responses', () => {
        const { ha, thinq } = makeDevice()

        thinq.emit('data', buf(WASHER_LAUNDRY_CARE_ON_STATUS))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/laundry_care'], 'ON')
        assert.equal(ha.devices[DEVICE_ID].properties['washer/cycle_count'], 44)

        thinq.emit('data', buf(WASHER_LAUNDRY_CARE_OFF_STATUS))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/laundry_care'], 'OFF')
    })

    test('rejects a truncated Korean state block', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf('aa11360a00780000000000eb00010000bb'))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/state'], undefined)
    })
})

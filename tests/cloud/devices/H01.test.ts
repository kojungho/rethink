import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/H01'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const META: Metadata = { modelId: 'H01', modelName: 'H01', swVersion: '1', deviceType: '204' }
const CAPTURED_STATUS = 'AA2032EB001800000001270000000100000200000042804100000000000365BB'
const STATUS_HEX = '0018000000012700000001000002000000428041000000000003'

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe('H01', () => {
    test('publishes a read-only diagnostic component', () => {
        const { ha } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>
        assert.equal(components.protocol_status.platform, 'sensor')
        assert.equal(components.protocol_status.entity_category, 'diagnostic')
        assert.equal(components.protocol_status.command_topic, undefined)
    })

    test('start sends the standard full-state query', () => {
        const { thinq, dev } = makeDevice()
        dev.start()
        assert.equal(hex(thinq.outbox[0]), 'AA0EF0ED1211010000010400EBBB')
    })

    test('decodes the captured 0x32eb initial status', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(CAPTURED_STATUS))
        assert.equal(ha.devices[DEVICE_ID].properties.protocol_status, STATUS_HEX)
    })

    test('uses the current half of a 0x32ec status update', () => {
        const { ha, thinq } = makeDevice()
        const previous = '00'.repeat(26)
        const current = '11'.repeat(26)
        thinq.emit('data', buf(`AA3A32EC${previous}${current}00BB`))
        assert.equal(ha.devices[DEVICE_ID].properties.protocol_status, current.toUpperCase())
    })

    test('ignores unknown and malformed frames', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf('AA0632EB00BB'))
        thinq.emit('data', buf(`AA2231EB${'00'.repeat(26)}00BB`))
        assert.deepEqual(ha.devices[DEVICE_ID].properties, {})
    })
})

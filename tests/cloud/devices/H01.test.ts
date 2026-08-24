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

function statusBlock(data?: Buffer) {
    return Buffer.concat([Buffer.from([0x00, 0x18]), data ?? Buffer.alloc(24)])
}

function frame(inner: Buffer) {
    return Buffer.concat([Buffer.from([0xaa, inner.length + 4]), inner, Buffer.from([0x00, 0xbb])])
}

describe('H01', () => {
    test('publishes status, settings, operation, remote-start, energy, and diagnostic components', () => {
        const { ha } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>

        assert.equal(components.state.platform, 'sensor')
        assert.equal(components.door.platform, 'binary_sensor')
        assert.equal(components.rinse_level.platform, 'number')
        assert.equal(components.auto_dry.platform, 'switch')
        assert.equal(components.steam.platform, 'binary_sensor')
        assert.equal(components.power.platform, 'switch')
        assert.equal(components.pause.platform, 'button')
        assert.equal(components.remote_course.platform, 'select')
        assert.equal(components.remote_steam.platform, 'switch')
        assert.equal(components.remote_start.platform, 'button')
        assert.equal(components.energy_total.device_class, 'energy')
        assert.equal(components.protocol_status.entity_category, 'diagnostic')
    })

    test('start publishes remote defaults and sends the standard full-state query', () => {
        const { ha, thinq, dev } = makeDevice()
        dev.start()

        assert.equal(ha.devices[DEVICE_ID].properties.remote_course, 'AUTO')
        assert.equal(ha.devices[DEVICE_ID].properties.remote_delay, 0)
        assert.equal(ha.devices[DEVICE_ID].properties.remote_steam, 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties.remote_high_temp, 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties.remote_extra_dry, 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties.remote_extra_rinse, 0)
        assert.equal(hex(thinq.outbox[0]), 'AA0EF0ED1211010000010400EBBB')
    })

    test('decodes the captured 0x32eb initial status', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(CAPTURED_STATUS))
        const properties = ha.devices[DEVICE_ID].properties

        assert.equal(properties.protocol_status, STATUS_HEX)
        assert.equal(properties.state, 'OFF')
        assert.equal(properties.power, 'OFF')
        assert.equal(properties.course, 'OFF')
        assert.equal(properties.initial_time, 99)
        assert.equal(properties.remaining_time, 1)
        assert.equal(properties.delay_start, 0)
        assert.equal(properties.door, 'OPEN')
        assert.equal(properties.rinse_level, 0)
        assert.equal(properties.salt_level, 0)
        assert.equal(properties.remote_mode, 'ALWAYS')
        assert.equal(properties.buzzer, 'LOW')
    })

    test('classifies repeated recognized packets as mapped and unknown packets as unmapped', () => {
        const { thinq } = makeDevice()
        const classifications: boolean[] = []
        thinq.on('packetData', (_packet, mapped) => classifications.push(mapped))

        thinq.receivePacket(buf(CAPTURED_STATUS))
        thinq.receivePacket(buf(CAPTURED_STATUS))
        thinq.receivePacket(buf('AA0631EB00BB'))

        assert.deepEqual(classifications, [true, true, false])
    })

    test('uses and fully decodes the current half of a 0x32ec status update', () => {
        const { ha, thinq } = makeDevice()
        const current = Buffer.alloc(24)
        current[0] = 0x02
        current[3] = 0x01
        current[4] = 0x1e
        current[5] = 0x01
        current[7] = 0x00
        current[8] = 0x2a
        current[9] = 0x02
        current[11] = 0x52
        current[12] = 0x0c
        current[13] = 0x03
        current[14] = 0x04
        current[15] = 0x82
        current[16] = 0x84
        current[19] = 0x40
        current[20] = 0x03
        current[21] = 0x30
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))
        const properties = ha.devices[DEVICE_ID].properties

        assert.equal(properties.state, 'RUNNING')
        assert.equal(properties.power, 'ON')
        assert.equal(properties.course, 'GLASS_AND_WINE')
        assert.equal(properties.initial_time, 90)
        assert.equal(properties.remaining_time, 42)
        assert.equal(properties.delay_start, 2)
        assert.equal(properties.door, 'OPEN')
        assert.equal(properties.clean_reminder, 'ON')
        assert.equal(properties.auto_dry, 'ON')
        assert.equal(properties.extra_dry, 'ON')
        assert.equal(properties.high_temp, 'ON')
        assert.equal(properties.steam, 'OFF')
        assert.equal(properties.rinse_level, 3)
        assert.equal(properties.salt_level, 4)
        assert.equal(properties.remote_start_active, 'ON')
        assert.equal(properties.remote_mode, 'ALWAYS')
        assert.equal(properties.end_alarm, 'ON')
        assert.equal(properties.brightness, 'HIGH')
        assert.equal(properties.buzzer, 'HIGH')
        assert.equal(properties.downloaded_course, 'GLASS_AND_WINE')
        assert.equal(properties.extra_rinse, 3)
    })

    test('decodes 0x323e energy and 0x32cf diagnostic packets', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', frame(Buffer.from('323E00C1015A02', 'hex')))
        const diagnostic = Buffer.alloc(115)
        diagnostic[0] = 0x32
        diagnostic[1] = 0xcf
        diagnostic[8] = 0x03
        thinq.emit('data', frame(diagnostic))

        assert.equal(ha.devices[DEVICE_ID].properties.energy_delta, 193)
        assert.equal(ha.devices[DEVICE_ID].properties.energy_total, 346)
        assert.equal(ha.devices[DEVICE_ID].properties.diagnostic_stage, 'RINSING')
    })

    test('emits wake, power-off, pause, resume, and cancel commands', () => {
        const { thinq, dev } = makeDevice()

        dev.setProperty('power', 'ON')
        dev.setProperty('power', 'OFF')
        dev.setProperty('pause', '')
        dev.setProperty('resume', '')
        dev.setProperty('cancel', '')

        assert.deepEqual(thinq.outbox.map(hex), [
            'AA07F0261688BB',
            'AA07F026128CBB',
            'AA07F026138FBB',
            'AA07F026148EBB',
            'AA07F026118DBB',
        ])
    })

    test('preserves cached settings while changing one option', () => {
        const { thinq, dev } = makeDevice()
        const current = Buffer.alloc(24)
        current[0] = 0x01
        current[11] = 0x50
        current[13] = 0x03
        current[14] = 0x04
        current[15] = 0x80
        current[16] = 0x84
        current[19] = 0x40
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xeb]), statusBlock(current)])))

        dev.setProperty('auto_dry', 'OFF')
        assert.equal(hex(thinq.outbox.at(-1)!), 'AA0FF02603044C804000000000B7BB')
    })

    test('does not send a settings overwrite before receiving status', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('rinse_level', '4')
        assert.equal(thinq.outbox.length, 0)
    })

    test('builds remote start from all virtual options', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('remote_course', 'DOWNLOAD_CYCLE')
        dev.setProperty('remote_delay', '12')
        dev.setProperty('remote_steam', 'ON')
        dev.setProperty('remote_high_temp', 'ON')
        dev.setProperty('remote_extra_dry', 'ON')
        dev.setProperty('remote_extra_rinse', '3')
        dev.setProperty('remote_start', '')

        assert.equal(hex(thinq.outbox.at(-1)!), 'AA0DF026100B0C008C58008DBB')
    })

    test('decodes and sends the captured steam option bit', () => {
        const { ha, thinq, dev } = makeDevice()
        const current = Buffer.alloc(24)
        current[0] = 0x02
        current[12] = 0x80
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))

        assert.equal(ha.devices[DEVICE_ID].properties.steam, 'ON')

        dev.setProperty('remote_course', 'AUTO')
        dev.setProperty('remote_steam', 'ON')
        dev.setProperty('remote_start', '')
        assert.equal(hex(thinq.outbox.at(-1)!), 'AA0DF026100100008000000BBB')
    })

    test('ignores unknown and malformed frames', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf('AA0632EB00BB'))
        thinq.emit(
            'data',
            frame(Buffer.concat([Buffer.from([0x32, 0xeb]), Buffer.from([0x01, 0x18]), Buffer.alloc(24)])),
        )
        thinq.emit('data', frame(Buffer.from('313E00C1015A02', 'hex')))
        assert.deepEqual(ha.devices[DEVICE_ID].properties, {})
    })
})

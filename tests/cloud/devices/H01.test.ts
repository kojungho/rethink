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

function assertMinutesFromNow(value: unknown, minutes: number) {
    assert.equal(typeof value, 'string')
    assert.ok(Math.abs((Date.parse(value as string) - Date.now()) / 60_000 - minutes) < 0.1)
}

describe('H01', () => {
    test('publishes status, settings, operation, remote-start, energy, and diagnostic components', () => {
        const { ha } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>

        assert.equal(components.state.platform, 'sensor')
        assert.equal(components.state.device_class, 'enum')
        assert.ok((components.state.options as string[]).includes('야간 건조'))
        assert.ok((components.state.options as string[]).includes('정전'))
        assert.equal(components.course.device_class, 'enum')
        assert.ok((components.course.options as string[]).includes('통살균'))
        assert.equal(components.downloaded_course.device_class, 'enum')
        assert.ok((components.downloaded_course.options as string[]).includes('기계 세척'))
        assert.equal(components.remaining_time.device_class, 'timestamp')
        assert.equal(components.remaining_time.unit_of_measurement, undefined)
        assert.equal(components.tub_clean_count.name, '통살균 후 사용 횟수')
        assert.equal(components.filter_remaining.unit_of_measurement, '%')
        assert.equal(components.filter_remaining.entity_category, 'diagnostic')
        assert.equal(components.door.platform, 'binary_sensor')
        assert.equal(components.rinse_level.platform, 'number')
        assert.equal(components.auto_dry, undefined)
        assert.equal(components.brightness, undefined)
        assert.equal(components.power.platform, 'switch')
        assert.equal(components.operation.platform, 'select')
        assert.deepEqual(components.operation.options, ['시작', '정지', '취소', '전원 끄기'])
        assert.match(components.operation.command_template as string, /시작/)
        assert.equal(components.pause.platform, 'button')
        assert.equal(components.remote_course.platform, 'select')
        assert.equal(components.remote_high_temp, undefined)
        assert.equal(components.remote_extra_dry, undefined)
        assert.equal(components.steam.platform, 'binary_sensor')
        assert.equal(components.intensive_wash.platform, 'sensor')
        assert.equal(components.safe_rinse.platform, 'binary_sensor')
        assert.equal(components.hot_air_dry.platform, 'sensor')
        assert.equal(components.remote_steam, undefined)
        assert.equal(components.remote_start.platform, 'button')
        assert.equal(components.energy_total.device_class, 'energy')
        assert.equal(components.protocol_status.entity_category, 'diagnostic')
    })

    test('removes only retired or unsupported components before publishing the normal config', () => {
        const ha = new MockHAConnection()
        const configs: Array<Record<string, Record<string, unknown>>> = []
        const publishConfig = ha.publishConfig.bind(ha)
        ha.publishConfig = (id, config) => {
            configs.push(config.components as Record<string, Record<string, unknown>>)
            publishConfig(id, config)
        }

        new DUT(ha.asConnection(), new MockThinq2Device(DEVICE_ID, META), META)

        assert.equal(configs.length, 2)
        assert.deepEqual(configs[0].state, { platform: 'sensor' })
        assert.deepEqual(configs[0].course, { platform: 'sensor' })
        assert.deepEqual(configs[0].downloaded_course, { platform: 'sensor' })
        assert.deepEqual(configs[0].remaining_time, { platform: 'sensor' })
        assert.deepEqual(configs[0].initial_time, { platform: 'sensor' })
        assert.deepEqual(configs[0].remote_steam, { platform: 'switch' })
        assert.deepEqual(configs[0].remote_high_temp, { platform: 'switch' })
        assert.deepEqual(configs[0].remote_extra_dry, { platform: 'switch' })
        assert.deepEqual(configs[0].brightness, { platform: 'select' })
        assert.deepEqual(configs[0].auto_dry, { platform: 'switch' })
        assert.equal(configs[1].steam.platform, 'binary_sensor')
        assert.equal(configs[1].remote_steam, undefined)
        assert.equal(configs[1].remote_high_temp, undefined)
        assert.equal(configs[1].remote_extra_dry, undefined)
        assert.equal(configs[1].brightness, undefined)
        assert.equal(configs[1].auto_dry, undefined)
    })

    test('start publishes remote defaults and sends the standard full-state query', () => {
        const { ha, thinq, dev } = makeDevice()
        dev.start()

        assert.equal(ha.devices[DEVICE_ID].properties.remote_course, 'AUTO')
        assert.equal(ha.devices[DEVICE_ID].properties.remote_delay, 0)
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
        assert.equal(properties.course, '꺼짐')
        assert.equal(properties.initial_time, '')
        assert.equal(properties.remaining_time, '')
        assert.equal(properties.delay_start, 0)
        assert.equal(properties.door, 'OPEN')
        assert.equal(properties.rinse_level, 0)
        assert.equal(properties.salt_level, 0)
        assert.equal(properties.remote_mode, 'ALWAYS')
        assert.equal(properties.buzzer, 'LOW')
        assert.equal(properties.filter_remaining, 65)
        assert.equal(properties.tub_clean_count, 3)
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
        current[17] = 0x40
        current[19] = 0x40
        current[20] = 0x03
        current[21] = 0x30
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))
        const properties = ha.devices[DEVICE_ID].properties

        assert.equal(properties.state, 'RUNNING')
        assert.equal(properties.power, 'ON')
        assert.equal(properties.course, '자동')
        assert.equal(properties.initial_time, 90)
        assertMinutesFromNow(properties.remaining_time, 42)
        assert.equal(properties.delay_start, 2)
        assert.equal(properties.door, 'OPEN')
        assert.equal(properties.clean_reminder, 'ON')
        assert.equal(properties.extra_dry, 'ON')
        assert.equal(properties.high_temp, 'ON')
        assert.equal(properties.rinse_level, 3)
        assert.equal(properties.salt_level, 4)
        assert.equal(properties.remote_start_active, 'ON')
        assert.equal(properties.remote_mode, 'ALWAYS')
        assert.equal(properties.end_alarm, 'ON')
        assert.equal(properties.buzzer, 'HIGH')
        assert.equal(properties.filter_remaining, 64)
        assert.equal(properties.downloaded_course, 'GLASS_AND_WINE')
        assert.equal(properties.extra_rinse, 3)
    })

    test('reports the panel-off 0x04 state as OFF instead of standby', () => {
        const { ha, thinq } = makeDevice()
        const current = Buffer.alloc(24)
        current[0] = 0x04
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))

        assert.equal(ha.devices[DEVICE_ID].properties.state, 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties.power, 'OFF')
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

    test('maps official operation options to the captured control commands', () => {
        const { thinq, dev } = makeDevice()

        dev.setProperty('operation', 'start')
        dev.setProperty('operation', 'stop')
        dev.setProperty('operation', 'cancel')
        dev.setProperty('operation', 'power_off')

        assert.deepEqual(thinq.outbox.map(hex), [
            'AA07F026148EBB',
            'AA07F026138FBB',
            'AA07F026118DBB',
            'AA07F026128CBB',
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

        dev.setProperty('clean_reminder', 'OFF')
        assert.equal(hex(thinq.outbox.at(-1)!), 'AA0EF0260304F482000000001EBB')
    })

    test('preserves H01 reserved settings bits from the real app capture', () => {
        const { thinq, dev } = makeDevice()
        const current = Buffer.alloc(24)
        current[11] = 0x52
        current[13] = 0x03
        current[14] = 0x01
        current[15] = 0x4b
        current[16] = 0x97
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xeb]), statusBlock(current)])))

        dev.setProperty('rinse_level', '3')

        assert.equal(hex(thinq.outbox.at(-1)!), 'AA0EF0260301FA82000000001BBB')
    })

    test('does not send a settings overwrite before receiving status', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('rinse_level', '4')
        assert.equal(thinq.outbox.length, 0)
    })

    test('builds remote start without unsupported high-temp and extra-dry options', () => {
        const { thinq, dev } = makeDevice()
        dev.setProperty('remote_course', 'DOWNLOAD_CYCLE')
        dev.setProperty('remote_delay', '12')
        dev.setProperty('remote_extra_rinse', '3')
        dev.setProperty('remote_start', '')

        assert.equal(hex(thinq.outbox.at(-1)!), 'AA0DF026100B0C0000580019BB')
    })

    test('uses the final 0x0018 status and skips an interleaved 0x050d statistics block', () => {
        const { ha, thinq } = makeDevice()
        const previous = Buffer.alloc(24)
        previous[0] = 0x01
        const current = Buffer.alloc(24)
        current[0] = 0x03
        current[5] = 0x12
        const statistics = Buffer.concat([Buffer.from([0x05, 0x0d]), Buffer.alloc(13, 0xaa)])

        thinq.emit(
            'data',
            frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(previous), statistics, statusBlock(current)])),
        )

        assert.equal(ha.devices[DEVICE_ID].properties.state, 'PAUSE')
        assert.equal(ha.devices[DEVICE_ID].properties.course, 'UNKNOWN_0x12')
    })

    test('decodes all H01 courses captured from the physical controls', () => {
        const { ha, thinq } = makeDevice()
        const expected: Array<[number, string]> = [
            [0x01, '자동'],
            [0x05, '표준'],
            [0x02, '강력'],
            [0x10, '야간조용'],
            [0x09, '통살균'],
            [0x06, '다운로드'],
            [0x0f, '건조단독'],
        ]

        for (const [course, name] of expected) {
            const current = Buffer.alloc(24)
            current[5] = course
            if (course === 0x06) current[20] = 0x0a
            thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))
            assert.equal(ha.devices[DEVICE_ID].properties.course, name)
            if (course === 0x06) assert.equal(ha.devices[DEVICE_ID].properties.downloaded_course, 'RINSE_ONLY')
        }
    })

    test('decodes captured steam, intensive wash, sanitizing, safe rinse, and hot-air dry options', () => {
        const { ha, thinq } = makeDevice()
        const current = Buffer.alloc(24)
        current[12] = 0xc8
        current[15] = 0x34
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))
        const properties = ha.devices[DEVICE_ID].properties

        assert.equal(properties.steam, 'ON')
        assert.equal(properties.intensive_wash, '상단')
        assert.equal(properties.high_temp, 'ON')
        assert.equal(properties.safe_rinse, 'ON')
        assert.equal(properties.hot_air_dry, '90분')

        current[12] = 0xa0
        current[15] = 0x10
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))
        assert.equal(properties.intensive_wash, '하단')
        assert.equal(properties.hot_air_dry, '40분')

        current[12] = 0x80
        current[15] = 0x20
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))
        assert.equal(properties.intensive_wash, '전체')
        assert.equal(properties.hot_air_dry, '60분')

        current[12] = 0
        current[15] = 0
        thinq.emit('data', frame(Buffer.concat([Buffer.from([0x32, 0xec]), statusBlock(), statusBlock(current)])))
        assert.equal(properties.steam, 'OFF')
        assert.equal(properties.safe_rinse, 'OFF')
        assert.equal(properties.hot_air_dry, '꺼짐')
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

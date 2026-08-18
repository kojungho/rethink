import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/PAC_910604_WW'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const META: Metadata = { modelId: 'PAC_910604_WW', modelName: 'PAC_910604_WW', swVersion: '1.0' }
const COOL_STATUS = buf(
    '000004000000a8670201ff0b010102d801010000040000000000000000000001002b37000000000000000001000000ffffffff0700050004000400064300000000010000010300140001000000001800000002010269324a1e00320000000000000000000061000019190002e4030c033403200244027b028f028585007c1800000000057f0004d00005dd00000a23000000000000001d060000000000000000000005002800000002e4000000004552cc0041ce0000000a2d0a2604af04a400000000010104000019000000000000000000000000006400da000217070000010e010e000000000100000000010100000000000002cc0001030500000001000014000087000086000000000000000000000000000000000004021a01038e560000000100010000000000000000000000054725',
)
const CURRENT_TEMP = buf('000004000000a70204a0057f5038c4836959')

function makeDevice() {
    const ha = new MockHAConnection(),
        thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    ha.on('setProperty', (id: string, prop: string, value: string) => dev.setProperty(prop, value))
    thinq.resetRecorder()
    return { ha, thinq, dev }
}

describe('PAC_910604_WW', () => {
    test('publishes PAC climate and sensor discovery', () => {
        const { ha, dev } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components
        for (const id of [
            'climate',
            'humidity',
            'pm1',
            'pm2_5',
            'pm10',
            'filter_remaining',
            'energy_current',
            'uvnano',
            'air_quality_sensor',
            'airclean',
            'energysave',
            'jet',
            'space_airflow',
            'outlet',
        ])
            assert.ok(components[id])
        for (const id of ['capacity', 'eev', 'fanrpm', 'oduairtemp', 'oduhextemp', 'pipeintemp', 'pipeouttemp'])
            assert.equal(components[id], undefined)
        assert.equal(components.ai_dry_power, undefined)
        assert.deepEqual((components.ai_dry as { options: string[] }).options, [
            '꺼짐',
            '1단',
            '2단',
            '3단',
            '4단',
            '5단',
        ])
        assert.equal((components.space_airflow as { name: string }).name, '공간맞춤 바람')
        assert.equal((components.space_airflow as { availability: { topic: string }[] }).availability.length, 3)
        assert.deepEqual((components.display_light as { options: string[] }).options, [
            '꺼짐',
            '20%',
            '40%',
            '60%',
            '80%',
            '100%',
        ])
        assert.deepEqual((components.button_sound as { options: string[] }).options, [
            '꺼짐',
            '20%',
            '40%',
            '60%',
            '80%',
            '100%',
        ])
        const climate = components.climate as unknown as Record<string, unknown>
        assert.deepEqual(climate.fan_modes, ['1단', '2단', '3단', '4단', '5단'])
        assert.deepEqual(climate.swing_modes, ['집중', '분리', '와이드', '좌', '우'])
        assert.equal(climate.swing_horizontal_modes, undefined)
        assert.equal((components.quiet as { name: string }).name, '저소음 냉방')
        assert.equal((components.outlet as { name: string }).name, '토출구 열기')
        assert.equal(components.airflow_direction, undefined)
        dev.drop()
    })
    test('changes the fan mode list for dry while retaining it when powered off', () => {
        const { ha, dev } = makeDevice()
        const climate = () =>
            ha.devices[DEVICE_ID].config!.components.climate as unknown as Record<string, unknown>

        dev.processKeyValue(0x1f9, 1)
        assert.deepEqual(climate().fan_modes, ['자동'])

        dev.processKeyValue(0x1f7, 0)
        assert.deepEqual(climate().fan_modes, ['자동'])

        dev.processKeyValue(0x1f9, 0)
        assert.deepEqual(climate().fan_modes, ['1단', '2단', '3단', '4단', '5단'])

        dev.processKeyValue(0x1f9, 2)
        assert.deepEqual(climate().fan_modes, ['1단', '2단', '3단', '4단', '5단'])
        dev.drop()
    })
    test('decodes A8 sensors and A7 temperature', () => {
        const { ha, thinq, dev } = makeDevice()
        thinq.emit('data', COOL_STATUS)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'current_temperature'), 27.5)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'fan_mode_state'), '3단')
        assert.equal(ha.devices[DEVICE_ID].properties.humidity, 67)
        assert.equal(ha.devices[DEVICE_ID].properties.pm1, 4)
        assert.equal(ha.devices[DEVICE_ID].properties.pm2_5, 4)
        assert.equal(ha.devices[DEVICE_ID].properties.pm10, 6)
        assert.equal(ha.devices[DEVICE_ID].properties.filter_remaining, 86)
        thinq.emit('data', CURRENT_TEMP)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'current_temperature'), 28)
        dev.drop()
    })
    test('maps PAC-specific controls', () => {
        const { ha, thinq, dev } = makeDevice()
        ha.setProperty(DEVICE_ID, 'ai_dry', 'command', '5단')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /8390ff7c86/i)
        ha.setProperty(DEVICE_ID, 'climate', 'fan_mode_command', '1단')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /7e82/i)
        ha.setProperty(DEVICE_ID, 'climate', 'fan_mode_command', '5단')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /7e86/i)
        ha.setProperty(DEVICE_ID, 'ai_dry', 'command', '꺼짐')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /8380/i)
        ha.setProperty(DEVICE_ID, 'outlet', 'command', 'ON')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /e481/i)
        ha.setProperty(DEVICE_ID, 'outlet', 'command', 'OFF')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /e480/i)
        ha.setProperty(DEVICE_ID, 'climate', 'swing_mode_command', '분리')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /a8c5/i)
        const offCount = thinq.outbox.length
        ha.setProperty(DEVICE_ID, 'space_airflow', 'command', 'ON')
        assert.equal(thinq.outbox.length, offCount)
        thinq.emit('data', COOL_STATUS)
        const coolingCount = thinq.outbox.length
        ha.setProperty(DEVICE_ID, 'outlet', 'command', 'ON')
        assert.equal(thinq.outbox.length, coolingCount)
        ha.setProperty(DEVICE_ID, 'space_airflow', 'command', 'ON')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /6f81/i)
        ha.setProperty(DEVICE_ID, 'quiet', 'command', 'ON')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /a741/i)
        ha.setProperty(DEVICE_ID, 'uvnano', 'command', 'ON')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /a881/i)
        ha.setProperty(DEVICE_ID, 'jet', 'command', 'ON')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /8d81/i)
        ha.setProperty(DEVICE_ID, 'air_quality_sensor', 'command', '항상')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /65fd0100050c00000001/i)
        ha.setProperty(DEVICE_ID, 'climate', 'mode_command', 'fan_only')
        assert.match(thinq.outbox.at(-1)!.toString('hex'), /7dc17e45/i)
        const sentCount = thinq.outbox.length
        thinq.emit('data', buf('000004000000a7020445117dc17e457f903c7e8483c1d2058f41c48ff538'))
        assert.equal(thinq.outbox.length, sentCount)
        dev.drop()
    })
})

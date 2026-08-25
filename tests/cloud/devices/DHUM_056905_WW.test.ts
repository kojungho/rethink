import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/DHUM_056905_WW'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-dehumidifier'
const META: Metadata = { modelId: 'DHUM_056905_WW', modelName: 'DHUM_056905_WW', swVersion: '1', deviceType: '401' }

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe('DHUM_056905_WW', () => {
    test('keeps MQTT values in English while exposing Korean display options', () => {
        const { ha, dev } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>

        assert.deepEqual(components.operating_mode.options, [
            '스마트 제습',
            '쾌속 제습',
            '저소음 제습',
            '집중 건조',
            '의류 건조',
        ])
        assert.deepEqual(components.fan_speed.options, ['약풍', '강풍'])
        assert.deepEqual(components.humidity_sensor_mode.options, ['항상', '운전시'])
        assert.match(components.operating_mode.value_template as string, /SMART_HUMIDITY/)
        assert.match(components.operating_mode.command_template as string, /스마트 제습/)

        dev.processKeyValue(0x1f9, 0x11)
        dev.processKeyValue(0x1fa, 2)
        dev.processKeyValue(0x337, 1)
        assert.equal(ha.devices[DEVICE_ID].properties.operating_mode, 'SMART_HUMIDITY')
        assert.equal(ha.devices[DEVICE_ID].properties.fan_speed, 'LOW')
        assert.equal(ha.devices[DEVICE_ID].properties.humidity_sensor_mode, 'ALWAYS')
    })
})

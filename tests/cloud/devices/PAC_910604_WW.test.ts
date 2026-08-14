import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/PAC_910604_WW'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const META: Metadata = { modelId: 'PAC_910604_WW', modelName: 'PAC_910604_WW', swVersion: '1.0' }
const COOL_STATUS = buf('000004000000a8670201ff0b010102d801010000040000000000000000000001002b37000000000000000001000000ffffffff0700050004000400064300000000010000010300140001000000001800000002010269324a1e00320000000000000000000061000019190002e4030c033403200244027b028f028585007c1800000000057f0004d00005dd00000a23000000000000001d060000000000000000000005002800000002e4000000004552cc0041ce0000000a2d0a2604af04a400000000010104000019000000000000000000000000006400da000217070000010e010e000000000100000000010100000000000002cc0001030500000001000014000087000086000000000000000000000000000000000004021a01038e560000000100010000000000000000000000054725')
const CURRENT_TEMP = buf('000004000000a70204a0057f5038c4836959')

function makeDevice() {
    const ha = new MockHAConnection(), thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    ha.on('setProperty', (id: string, prop: string, value: string) => dev.setProperty(prop, value))
    thinq.resetRecorder()
    return { ha, thinq, dev }
}

describe('PAC_910604_WW', () => {
    test('publishes PAC climate and sensor discovery', () => {
        const { ha, dev } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components
        for (const id of ['climate', 'humidity', 'pm2_5', 'pm10', 'filter_remaining', 'energy_current']) assert.ok(components[id])
        dev.drop()
    })
    test('decodes A8 sensors and A7 temperature', () => {
        const { ha, thinq, dev } = makeDevice()
        thinq.emit('data', COOL_STATUS)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'current_temperature'), 27.5)
        assert.equal(ha.devices[DEVICE_ID].properties.humidity, 67)
        assert.equal(ha.devices[DEVICE_ID].properties.pm2_5, 4)
        assert.equal(ha.devices[DEVICE_ID].properties.pm10, 6)
        assert.equal(ha.devices[DEVICE_ID].properties.filter_remaining, 86)
        thinq.emit('data', CURRENT_TEMP)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'current_temperature'), 28)
        dev.drop()
    })
})

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/2REFO2DJC4K_U'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = '2REFO2DJC4K_U'
const META: Metadata = { modelId: MODEL_ID, modelName: MODEL_ID, swVersion: '1.0' }

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

function aabb(inner: Buffer) {
    return Buffer.concat([Buffer.from([0xaa, inner.length + 4]), inner, Buffer.from([0, 0xbb])])
}

function statusFrame(status: Buffer) {
    return aabb(Buffer.concat([Buffer.from([0x10, 0xeb]), status]))
}

describe(MODEL_ID, () => {
    test('publishes the additive diagnostic components without removing existing controls', () => {
        const { ha } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>

        assert.ok(components.fridge_setpoint)
        assert.ok(components.freezer_setpoint)
        assert.ok(components.express_freeze)
        assert.ok(components.craft_ice)
        assert.ok(components.dispenser_mode)
        assert.equal(components.dispense_volume.device_class, 'volume')
        assert.equal(components.dispense_volume.unit_of_measurement, 'mL')
        assert.ok(components.button_sound)
        assert.equal(components.express_cool_status.platform, 'binary_sensor')
        assert.equal(components.pure_n_fresh.platform, 'sensor')
        assert.equal(components.display_lock_raw.platform, 'sensor')
        assert.equal(components.energy_report_type.platform, 'sensor')
        assert.equal(components.energy_report_raw.platform, 'sensor')
        assert.equal(components.smart_care.platform, 'sensor')
        assert.equal(components.smart_care_control.platform, 'switch')
    })

    test('start() requests the full 68-byte status block', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.start()
        assert.equal(thinq.outbox.length, 1)
        assert.equal(hex(thinq.outbox[0]), 'AA0EF0ED1211010000010400EBBB')
    })

    test('decodes confirmed and candidate read-only status fields', () => {
        const { ha, thinq } = makeDevice()
        const status = Buffer.alloc(68, 0xff)
        status[1] = 5 // fridge 3 C
        status[2] = 4 // freezer -18 C
        status[3] = 1 // express freeze off
        status[4] = 2 // Pure N Fresh automatic
        status[7] = 0 // door closed
        status[10] = 1 // display-lock raw value; polarity intentionally unknown
        status[16] = 1 // express cool on
        status[17] = 0 // Smart Care off
        status[25] = 2 // six Craft Ice cubes
        status[30] = 0 // night glare disabled
        status[31] = 0 // night quiet disabled
        status[40] = 1 // button sound on
        status[65] = 50 // configured 500 mL dispense
        status[66] = 2 // water dispenser

        thinq.emit('data', statusFrame(status))
        const properties = ha.devices[DEVICE_ID].properties
        assert.equal(properties.express_cool_status, 'ON')
        assert.equal(properties.pure_n_fresh, '자동')
        assert.equal(properties.display_lock_raw, 1)
        assert.equal(properties.fridge_setpoint, 3)
        assert.equal(properties.freezer_setpoint, -18)
        assert.equal(properties.craft_ice, '6개 제빙')
        assert.equal(properties.dispenser_mode, '정수')
        assert.equal(properties.dispense_volume, 500)
        assert.equal(properties.smart_care, '꺼짐')
        assert.equal(properties.smart_care_control, 'OFF')
    })

    test('publishes only the confirmed fixed dispense volumes', () => {
        const { ha, thinq } = makeDevice()

        for (const [units, milliliters] of [
            [25, 250],
            [50, 500],
            [100, 1000],
        ]) {
            const status = Buffer.alloc(68, 0xff)
            status[65] = units
            thinq.emit('data', statusFrame(status))
            assert.equal(ha.devices[DEVICE_ID].properties.dispense_volume, milliliters)
        }

        const unconfirmed = Buffer.alloc(68, 0xff)
        unconfirmed[65] = 35
        thinq.emit('data', statusFrame(unconfirmed))
        assert.equal(ha.devices[DEVICE_ID].properties.dispense_volume, 1000)
    })

    test('does not report unsupported express cool as OFF', () => {
        const { ha, thinq } = makeDevice()
        const status = Buffer.alloc(68, 0xff)
        status[1] = 5
        status[2] = 4
        status[3] = 1
        status[4] = 2
        status[7] = 0
        status[17] = 0
        status[25] = 2
        status[30] = 0
        status[31] = 0
        status[40] = 1
        status[66] = 2

        thinq.emit('data', statusFrame(status))
        assert.equal(ha.devices[DEVICE_ID].properties.express_cool_status, undefined)
    })

    test('writes Smart Care on and off using the confirmed status[17] field', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()

        dev.setProperty('smart_care_control', 'ON')
        assert.equal(thinq.outbox.length, 1)
        assert.equal(thinq.outbox[0][4 + 17], 1)

        thinq.resetRecorder()
        dev.setProperty('smart_care_control', 'OFF')
        assert.equal(thinq.outbox.length, 1)
        assert.equal(thinq.outbox[0][4 + 17], 0)
    })

    test('publishes 10AF as raw diagnostics without assigning an energy unit', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', aabb(Buffer.from([0x10, 0xaf, 0x0f, 0x00, 0x1d])))

        const properties = ha.devices[DEVICE_ID].properties
        assert.equal(properties.energy_report_type, '0x0F')
        assert.equal(properties.energy_report_raw, 29)
    })
})

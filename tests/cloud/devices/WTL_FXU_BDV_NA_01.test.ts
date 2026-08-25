import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/WTL_FXU_BDV_NA_01'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'
import { encodePacket } from '@/util/packet-codec'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'WTL_FXU_BDV_NA_01'
const META: Metadata = { modelId: MODEL_ID, modelName: 'WKEX200HBA', swVersion: '1.0' }

// Real packet captures from an LG WashTower (washer+dryer combo).
// All full raw packets — processData strips aa/bb framing before calling processAABB.

// buf[3]=0xd0: full status, washer running Delicates, dryer off
const STATUS_WASHER_RUNNING =
    'aad0360a00d0008542000100ec00be013200030e0e0e1600000000000000002d002d00000016010000070000020f0202022d2d00000000000c380000000000070401002a000000000000000000003c00000001000200000200000000201800810700000000070000000000000000013200030e0e0e1600000000000000002d002d000000160b0100070000020f0202022d2d00000010000c380000000000070401002a000000000000000000003c0000000100020000020000000020180081070000000007000000000000000023a9bb'

// buf[3]=0x71: state resync, washer running Delicates (remote_start+door_lock ON), dryer off
const STATE_RESYNC =
    'aa71360a00710085f3000100eb005f013200030e0e0e1600000000000000002a002d000200160b2600070000020f0202022d2d00000010010c380000000000060401002a000000000000000000000000000001000200000000000000000000810700000000060000000000000000d05dbb'

// buf[3]=0x42: washer door events (62-byte inner; door state at inner[18], body[5] after header strip)
const WASHER_DOOR_OPEN =
    'aa42360a0042007d83000201030007100c010b1000330105002557544c5f4658555f4244565f4e41' +
    '5f30310000000102d71c0b8b010700000000000000000018babb'
const WASHER_DOOR_CLOSE =
    'aa42360a0042007d84000201030007100c010b1001330105002557544c5f4658555f4244565f4e41' +
    '5f30310000000102d51c0b8b0107000000000000000000c4cebb'

// buf[3]=0x4e: dryer door events (74-byte inner; door state at inner[29], body[16] after header strip)
const DRYER_DOOR_OPEN =
    'aa4e360a004e007d850002010300130a0a01040a000021ff000000000000000105340105002557544c' +
    '5f4658555f4244565f4e415f30310000000102d81c0b8b0107000000000000000000b590bb'
const DRYER_DOOR_CLOSE =
    'aa4e360a004e007d860002010300130a0a01040a00002200000000000000000005340105002557544c' +
    '5f4658555f4244565f4e415f30310000000102d71c0b8b0107000000000000000000b490bb'

// Expected raw bytes sent to the device (uppercase for hex() comparison)
const SEND_WASHER_POWER_ON = 'AA0DF0E50002013301020193BB'
const SEND_WASHER_POWER_OFF = 'AA0DF0E50002013301020090BB'
const SEND_DRYER_POWER_ON = 'AA0DF0E50002013401020192BB'
const SEND_DRYER_POWER_OFF = 'AA0DF0E50002013401020093BB'
const SEND_WASHER_START = 'AA0AF0240501003354BB'
const SEND_WASHER_STOP = 'AA0AF0240401003355BB'
const SEND_DRYER_START = 'AA0AF0240501003457BB'
const SEND_DRYER_STOP = 'AA0AF0240401003454BB'
const SEND_INIT_LCD_DEFAULT = 'AA0DF0E50002013301510041BB' // 'Default' = idx 0
const SEND_INIT_LCD_SPRING2 = 'AA0DF0E5000201330151054CBB' // 'Spring 2' = idx 5
const SEND_WASHER_BUZZER_OFF = 'AA0DF0E50002013301130083BB'
const SEND_WASHER_BUZZER_LOW = 'AA0DF0E50002013301130182BB'
const SEND_WASHER_BUZZER_VHIGH = 'AA0DF0E5000201330113048FBB'
const SEND_DRYER_BUZZER_OFF = 'AA0DF0E50002013401130082BB'
const SEND_DRYER_BUZZER_LOW = 'AA0DF0E5000201340113018DBB'
const SEND_DRYER_BUZZER_VHIGH = 'AA0DF0E5000201340113048EBB'
const SEND_START = 'AA0EF0ED1121010000001800B5BB'
const SEND_WASHER_REMOTE_MAINTAIN_ON = 'AA0AF0241001013358BB'
const SEND_WASHER_REMOTE_MAINTAIN_OFF = 'AA0AF0241001003359BB'
const SEND_WASHER_LAUNDRY_CARE_ON = 'AA0DF0E5000201330157014EBB'
const SEND_WASHER_LAUNDRY_CARE_OFF = 'AA0DF0E5000201330157004FBB'
const SEND_DRYER_REMOTE_MAINTAIN_ON = 'AA0AF024100101345BBB'
const SEND_DRYER_REMOTE_MAINTAIN_OFF = 'AA0AF0241001003458BB'

// Build a synthetic 0x71 state-resync packet with specific block byte overrides.
// Block starts at inner[13]; inner is 109 bytes (header=13, block=95, trailing=1).
function buildResync(blockOverrides: Record<number, number>): Buffer {
    const inner = Buffer.alloc(109)
    inner[3] = 0x71
    for (const [idx, val] of Object.entries(blockOverrides)) {
        inner[13 + Number(idx)] = val
    }
    return encodePacket({ protocol: 'aabb', body: inner.toString('hex') }).buffer
}

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    ha.on('setProperty', (id: string, prop: string, value: string) => {
        dev.setProperty(prop, value)
    })
    return { ha, thinq, dev }
}

function assertMinutesFromNow(value: unknown, minutes: number) {
    assert.equal(typeof value, 'string')
    assert.ok(Math.abs((Date.parse(value as string) - Date.now()) / 60_000 - minutes) < 0.1)
}

describe(MODEL_ID, () => {
    test('config exposes expected HA components', () => {
        const { ha } = makeDevice()
        const washerConfig = ha.devices[`${DEVICE_ID}-washer`].config!
        const dryerConfig = ha.devices[`${DEVICE_ID}-dryer`].config!
        const components = { ...washerConfig.components, ...dryerConfig.components } as Record<string, unknown>
        assert.equal(washerConfig.device.identifiers, '$deviceid-washer')
        assert.equal(washerConfig.device.name, '워시타워 세탁기')
        assert.equal(dryerConfig.device.identifiers, '$deviceid-dryer')
        assert.equal(dryerConfig.device.name, '워시타워 건조기')
        assert.deepEqual(ha.clearedConfigs, [DEVICE_ID])
        assert.ok(Object.keys(washerConfig.components).every((id) => id.startsWith('washer_') || id === 'init_lcd'))
        assert.ok(Object.keys(dryerConfig.components).every((id) => id.startsWith('dryer_')))
        for (const c of [
            'washer_state',
            'washer_power',
            'washer_door',
            'washer_course',
            'washer_temp',
            'washer_spin',
            'washer_remaining_time',
            'washer_delay_ends_at',
            'washer_operation',
            'washer_remote_maintain',
            'washer_laundry_care',
            'dryer_state',
            'dryer_power',
            'dryer_door',
            'dryer_course',
            'dryer_delay_ends_at',
            'dryer_operation',
            'dryer_remote_maintain',
            'init_lcd',
        ]) {
            assert.ok(components[c], `component ${c} present`)
        }
        // init_lcd select lists all themes
        const init_lcd = components.init_lcd as Record<string, unknown>
        assert.equal(init_lcd.platform, 'select')
        assert.equal(init_lcd.entity_category, 'config')
        assert.ok((init_lcd.options as string[]).includes('기본'))
        assert.ok((init_lcd.options as string[]).includes('크리스마스'))
        const washerPower = components.washer_power as Record<string, unknown>
        const dryerPower = components.dryer_power as Record<string, unknown>
        const washerState = components.washer_state as Record<string, unknown>
        const dryerState = components.dryer_state as Record<string, unknown>
        assert.equal(washerPower.platform, 'switch')
        assert.equal(dryerPower.platform, 'switch')
        assert.equal(washerState.device_class, 'enum')
        assert.equal(washerState.name, '현재 상태')
        assert.ok((washerState.options as string[]).includes('전원 꺼짐'))
        assert.ok((washerState.options as string[]).includes('통살균 중'))
        assert.ok((washerState.options as string[]).includes('종료'))
        assert.equal(dryerState.device_class, 'enum')
        assert.equal(dryerState.name, '현재 상태')
        assert.ok((dryerState.options as string[]).includes('전원 꺼짐'))
        assert.ok((dryerState.options as string[]).includes('드럼 케어'))
        assert.ok((dryerState.options as string[]).includes('AI 세탁물 확인'))
        assert.equal((components.washer_remaining_time as Record<string, unknown>).device_class, 'timestamp')
        assert.equal((components.dryer_remaining_time as Record<string, unknown>).device_class, 'timestamp')
        assert.equal((components.washer_delay_ends_at as Record<string, unknown>).device_class, 'timestamp')
        assert.equal((components.dryer_delay_ends_at as Record<string, unknown>).device_class, 'timestamp')
        assert.deepEqual((components.washer_operation as Record<string, unknown>).options, [
            '시작',
            '정지',
            '전원 끄기',
        ])
        assert.deepEqual((components.dryer_operation as Record<string, unknown>).options, ['시작', '정지', '전원 끄기'])
        assert.match((components.washer_operation as Record<string, unknown>).command_template as string, /시작/)
        for (const id of [
            'washer_course',
            'washer_error',
            'dryer_course',
            'dryer_dry_level',
            'dryer_error',
            'dryer_duct_clogging',
        ]) {
            const template = (components[id] as Record<string, unknown>).value_template as string
            assert.match(template, /NOT_SELECTED.*선택 안 함|NONE.*없음/)
        }
        assert.match(
            (components.washer_course as Record<string, unknown>).value_template as string,
            /TUB_CLEAN.*통살균/,
        )
        assert.match(
            (components.dryer_course as Record<string, unknown>).value_template as string,
            /QUICKDRY.*급속 건조/,
        )
        assert.match((components.washer_error as Record<string, unknown>).value_template as string, /ERROR_IE.*오류 IE/)
        assert.equal(washerPower.optimistic, undefined)
        assert.equal(dryerPower.optimistic, undefined)
        assert.equal((components.washer_buzzer as Record<string, unknown>).entity_category, 'config')
        assert.equal((components.dryer_remote_maintain as Record<string, unknown>).entity_category, 'config')
        assert.equal((components.washer_laundry_care as Record<string, unknown>).entity_category, 'config')
    })

    test('uses the official ThinQ alias for both split MQTT devices', () => {
        const ha = new MockHAConnection()
        const meta = { ...META, alias: '우리집 워시타워' }

        new DUT(ha.asConnection(), new MockThinq2Device(DEVICE_ID, meta), meta)

        assert.equal(ha.devices[`${DEVICE_ID}-washer`].config!.device.name, '우리집 워시타워 세탁기')
        assert.equal(ha.devices[`${DEVICE_ID}-dryer`].config!.device.name, '우리집 워시타워 건조기')
    })

    test('recreates settings components so Home Assistant applies their config category', () => {
        const ha = new MockHAConnection()
        const configs: Array<{ discoveryId: string; components: Record<string, Record<string, unknown>> }> = []
        const publishConfig = ha.publishConfig.bind(ha)
        ha.publishConfig = (id, config, discoveryId = id) => {
            configs.push({ discoveryId, components: config.components as Record<string, Record<string, unknown>> })
            publishConfig(id, config, discoveryId)
        }

        new DUT(ha.asConnection(), new MockThinq2Device(DEVICE_ID, META), META)

        assert.equal(configs.length, 4)
        assert.equal(configs[0].discoveryId, `${DEVICE_ID}-washer`)
        assert.deepEqual(configs[0].components.washer_buzzer, { platform: 'select' })
        assert.deepEqual(configs[0].components.washer_remaining_time, { platform: 'sensor' })
        assert.deepEqual(configs[0].components.washer_initial_time, { platform: 'sensor' })
        assert.deepEqual(configs[0].components.washer_remote_maintain, { platform: 'switch' })
        assert.deepEqual(configs[0].components.init_lcd, { platform: 'select' })
        assert.equal(configs[1].components.washer_buzzer.entity_category, 'config')
        assert.equal(configs[2].discoveryId, `${DEVICE_ID}-dryer`)
        assert.deepEqual(configs[2].components.dryer_buzzer, { platform: 'select' })
        assert.deepEqual(configs[2].components.dryer_remaining_time, { platform: 'sensor' })
        assert.deepEqual(configs[2].components.dryer_initial_time, { platform: 'sensor' })
        assert.deepEqual(configs[2].components.dryer_remote_maintain, { platform: 'switch' })
        assert.equal(configs[3].components.dryer_remote_maintain.entity_category, 'config')
    })

    test('0xd0 status packet decodes washer state', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(STATUS_WASHER_RUNNING))
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props['washer/power'], 'ON')
        assert.equal(props['washer/state'], 'RUNNING')
        assert.equal(props['washer/course'], 'DELICATES')
        assert.equal(props['washer/temp'], 'N/A')
        assertMinutesFromNow(props['washer/remaining_time'], 45)
        assert.equal(props['washer/initial_time'], 45)
        assert.equal(props['shared/init_lcd'], 'Summer 2')
    })

    test('0xd0 status packet decodes dryer state (dryer off in this capture)', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(STATUS_WASHER_RUNNING))
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props['dryer/power'], 'OFF')
        assert.equal(props['dryer/state'], 'POWEROFF')
        assert.equal(props['dryer/remaining_time'], '')
    })

    test('0x42 washer door open publishes washer/door=OPEN', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(WASHER_DOOR_OPEN))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/door'], 'OPEN')
    })

    test('0x42 washer door close publishes washer/door=CLOSE', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(WASHER_DOOR_CLOSE))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/door'], 'CLOSE')
    })

    test('0x4e dryer door open publishes dryer/door=OPEN', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(DRYER_DOOR_OPEN))
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/door'], 'OPEN')
    })

    test('0x4e dryer door close publishes dryer/door=CLOSE', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(DRYER_DOOR_CLOSE))
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/door'], 'CLOSE')
    })

    test('wrong-length 0xd0 packet is ignored', () => {
        const { ha, thinq } = makeDevice()
        // 0xd0 type but only 10 bytes inner — processStatusUpdate rejects body != 190 (STATE_BLOCK_LENGTH*2)
        thinq.emit('data', buf('aaff360a00d000854200010090bb'))
        assert.deepEqual(ha.devices[DEVICE_ID].properties, {})
    })

    test('setProperty washer/power ON sends correct packet', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('washer/power', 'ON')
        assert.equal(thinq.outbox.length, 1)
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_POWER_ON)
    })

    test('setProperty washer/power OFF sends correct packet', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('washer/power', 'OFF')
        assert.equal(thinq.outbox.length, 1)
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_POWER_OFF)
    })

    test('setProperty dryer/power ON sends correct packet', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('dryer/power', 'ON')
        assert.equal(thinq.outbox.length, 1)
        assert.equal(hex(thinq.outbox[0]), SEND_DRYER_POWER_ON)
    })

    test('setProperty dryer/power OFF sends correct packet', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('dryer/power', 'OFF')
        assert.equal(thinq.outbox.length, 1)
        assert.equal(hex(thinq.outbox[0]), SEND_DRYER_POWER_OFF)
    })

    test('setProperty operation sends start, stop, and power-off packets for each unit', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('washer/operation', 'start')
        dev.setProperty('washer/operation', 'stop')
        dev.setProperty('washer/operation', 'power_off')
        dev.setProperty('dryer/operation', 'start')
        dev.setProperty('dryer/operation', 'stop')
        dev.setProperty('dryer/operation', 'power_off')

        assert.deepEqual(thinq.outbox.map(hex), [
            SEND_WASHER_START,
            SEND_WASHER_STOP,
            SEND_WASHER_POWER_OFF,
            SEND_DRYER_START,
            SEND_DRYER_STOP,
            SEND_DRYER_POWER_OFF,
        ])
    })

    test('publishes reservation completion as a timestamp', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buildResync({ 13: 0x00, 14: 0x78, 23: 0x03 }))

        assertMinutesFromNow(ha.devices[DEVICE_ID].properties['washer/delay_ends_at'], 120)
    })

    test('setProperty shared/init_lcd sends correct packet with theme index', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('shared/init_lcd', 'Default')
        assert.equal(hex(thinq.outbox[0]), SEND_INIT_LCD_DEFAULT)

        thinq.resetRecorder()
        dev.setProperty('shared/init_lcd', 'Spring 2')
        assert.equal(hex(thinq.outbox[0]), SEND_INIT_LCD_SPRING2)
    })

    test('setProperty shared/init_lcd with unknown theme sends nothing', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('shared/init_lcd', 'NotATheme')
        assert.equal(thinq.outbox.length, 0)
    })

    test('start() sends get-full-state packet and defaults doors to CLOSE', () => {
        const { ha, thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.start()
        assert.equal(thinq.outbox.length, 1)
        assert.equal(hex(thinq.outbox[0]), SEND_START)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props['washer/door'], 'CLOSE')
        assert.equal(props['dryer/door'], 'CLOSE')
    })

    // ── 0x71 state resync ─────────────────────────────────────────────────────

    test('0x71 state resync decodes washer state', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(STATE_RESYNC))
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props['washer/power'], 'ON')
        assert.equal(props['washer/state'], 'RUNNING')
        assertMinutesFromNow(props['washer/remaining_time'], 42)
        assert.equal(props['washer/initial_time'], 45)
        assert.equal(props['washer/buzzer'], 'Medium')
        assert.equal(props['washer/remote_start'], 'ON')
        assert.equal(props['washer/door_lock'], 'ON')
        assert.equal(props['washer/add_garment'], 'OFF')
        assert.equal(props['washer/child_lock'], 'OFF')
        assert.equal(props['shared/init_lcd'], 'Summer 1')
    })

    test('0x71 state resync decodes dryer state', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf(STATE_RESYNC))
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props['dryer/power'], 'OFF')
        assert.equal(props['dryer/state'], 'POWEROFF')
        assert.equal(props['dryer/remaining_time'], '')
        assert.equal(props['dryer/buzzer'], 'Off')
        assert.equal(props['dryer/duct_clogging'], 'NONE')
        assert.equal(props['dryer/remote_start'], 'OFF')
        assert.equal(props['dryer/child_lock'], 'OFF')
    })

    test('wrong-length 0x71 packet is ignored', () => {
        const { ha, thinq } = makeDevice()
        // 0x71 type but only 10 bytes inner — processStateResync rejects body != 95 (STATE_BLOCK_LENGTH)
        thinq.emit('data', buf('aa0e360a00710000000000008abb'))
        assert.deepEqual(ha.devices[DEVICE_ID].properties, {})
    })

    // ── Synthetic bitmask field tests ─────────────────────────────────────────

    test('0x71 washer bitmask sensors decode correctly', () => {
        const { ha, thinq } = makeDevice()
        // block[39]=0xa0: add_garment(bit7) + child_lock(bit5); block[40]=0x01: door_lock
        thinq.emit('data', buildResync({ 39: 0xa0, 40: 0x01 }))
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props['washer/add_garment'], 'ON')
        assert.equal(props['washer/child_lock'], 'ON')
        assert.equal(props['washer/remote_start'], 'OFF')
    })

    test('0x71 dryer bitmask sensors decode correctly', () => {
        const { ha, thinq } = makeDevice()
        // block[79]=0x50: remote_start(bit6) + child_lock(bit4); block[75]=0x01: LEVEL_1
        thinq.emit('data', buildResync({ 79: 0x50, 75: 0x01 }))
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props['dryer/remote_start'], 'ON')
        assert.equal(props['dryer/child_lock'], 'ON')
        assert.equal(props['dryer/duct_clogging'], 'LEVEL_1')
    })

    // ── Buzzer commands ───────────────────────────────────────────────────────

    test('setProperty washer/buzzer sends correct packet', () => {
        const { thinq, dev } = makeDevice()

        thinq.resetRecorder()
        dev.setProperty('washer/buzzer', 'Off')
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_BUZZER_OFF)

        thinq.resetRecorder()
        dev.setProperty('washer/buzzer', 'Low')
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_BUZZER_LOW)

        thinq.resetRecorder()
        dev.setProperty('washer/buzzer', 'Very High')
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_BUZZER_VHIGH)
    })

    test('setProperty washer/buzzer with unknown value sends nothing', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('washer/buzzer', 'Deafening')
        assert.equal(thinq.outbox.length, 0)
    })

    test('setProperty dryer/buzzer sends correct packet', () => {
        const { thinq, dev } = makeDevice()

        thinq.resetRecorder()
        dev.setProperty('dryer/buzzer', 'Off')
        assert.equal(hex(thinq.outbox[0]), SEND_DRYER_BUZZER_OFF)

        thinq.resetRecorder()
        dev.setProperty('dryer/buzzer', 'Low')
        assert.equal(hex(thinq.outbox[0]), SEND_DRYER_BUZZER_LOW)

        thinq.resetRecorder()
        dev.setProperty('dryer/buzzer', 'Very High')
        assert.equal(hex(thinq.outbox[0]), SEND_DRYER_BUZZER_VHIGH)
    })

    test('setProperty dryer/buzzer with unknown value sends nothing', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('dryer/buzzer', 'VEYR_VERY_LOUD')
        assert.equal(thinq.outbox.length, 0)
    })

    // ── remote_maintain ───────────────────────────────────────────────────────

    test('0x71 washer remote_maintain decodes from block[42] bit2', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buildResync({ 42: 0x04 }))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/remote_maintain'], 'ON')

        const { ha: ha2, thinq: thinq2 } = makeDevice()
        thinq2.emit('data', buildResync({ 42: 0x00 }))
        assert.equal(ha2.devices[DEVICE_ID].properties['washer/remote_maintain'], 'OFF')
    })

    test('0x71 dryer remote_maintain decodes from block[80] bit1', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buildResync({ 80: 0x02 }))
        assert.equal(ha.devices[DEVICE_ID].properties['dryer/remote_maintain'], 'ON')

        const { ha: ha2, thinq: thinq2 } = makeDevice()
        thinq2.emit('data', buildResync({ 80: 0x00 }))
        assert.equal(ha2.devices[DEVICE_ID].properties['dryer/remote_maintain'], 'OFF')
    })

    test('setProperty washer/remote_maintain sends correct packet', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('washer/remote_maintain', 'ON')
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_REMOTE_MAINTAIN_ON)

        thinq.resetRecorder()
        dev.setProperty('washer/remote_maintain', 'OFF')
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_REMOTE_MAINTAIN_OFF)
    })

    test('setProperty dryer/remote_maintain sends correct packet', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('dryer/remote_maintain', 'ON')
        assert.equal(hex(thinq.outbox[0]), SEND_DRYER_REMOTE_MAINTAIN_ON)

        thinq.resetRecorder()
        dev.setProperty('dryer/remote_maintain', 'OFF')
        assert.equal(hex(thinq.outbox[0]), SEND_DRYER_REMOTE_MAINTAIN_OFF)
    })

    test('0x71 washer laundry care decodes from block[49] bit3', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buildResync({ 49: 0x0c }))
        assert.equal(ha.devices[DEVICE_ID].properties['washer/laundry_care'], 'ON')

        const { ha: ha2, thinq: thinq2 } = makeDevice()
        thinq2.emit('data', buildResync({ 49: 0x04 }))
        assert.equal(ha2.devices[DEVICE_ID].properties['washer/laundry_care'], 'OFF')
    })

    test('setProperty washer/laundry_care sends captured packets', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('washer/laundry_care', 'ON')
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_LAUNDRY_CARE_ON)

        thinq.resetRecorder()
        dev.setProperty('washer/laundry_care', 'OFF')
        assert.equal(hex(thinq.outbox[0]), SEND_WASHER_LAUNDRY_CARE_OFF)
    })
})

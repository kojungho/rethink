import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/HWWA9XC_F2U'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const META: Metadata = { modelId: 'HWWA9XC_F2U', modelName: 'HWWA9XC_F2U', swVersion: '1', deviceType: '264' }

const CHARGED =
    'AAFFD20A006000023B000100EC004E002504010101FF000101020203000100006301010102010100010203000B00000400010000FF00002504010101FF000101020203000100006301010202010100010203000B00000400010000FF0064A7BB'
const RUNNING =
    'AAFFD20A0060000298000100EC004E002504010101FF000101020203000100006301010102010100010203000B00000400010000FF00002502030101FF0001010202030001000E6201010102010100000203000B00000400010000FF005CD2BB'
const CHARGING =
    'AAFFD20A00600002B0000100EC004E002502030101FF0001010202030001000E6201010102010100000203000B00000400010000FF00002503010101FF000102020203000100006201010102010100010203000B00000400010000FF00B4F3BB'
const AUTO_EMPTY_ON =
    'AAFFD20A004C00022700010103003A0E0C03050E1600160000000200C61C4C1A014DB7B2E1720A5AAF15202322BD0100015B7600F6D31C001401030203020301010101000401000000FD48BB'
const AUTO_EMPTY_OFF =
    'AAFFD20A004C00024600010103003A0E0C03050E1600180000000200C61C4C1A014DB7B2E1720A5AAF15202322BD0100015B7600F6D31C0014010302030203010101000004010000008FFBBB'
const LOW_POWER =
    'AAFFD20A0060000411000100EC004E002503010101FF000101010203000100006301010103010100010203000B00000400010000FF00002503010101FF000101040203000100006301010103010100010203000B00000400010000FF007BF2BB'
const MOP_AND_VACUUM =
    'AAFFD20A0060000461000100EC004E002503010101FF000101030203000100006301010103010100010203000B00000400010000FF00002503010101FF000201030203000100006301010103010100010203000B00000400010000FF006C24BB'
const WATER_LEVEL_2 =
    'AAFFD20A0060000346000100EC004E002503010101FF000101030203000100006301010102010100010203000B00000400010000FF00002503010101FF000101030203000100006301010102010100010303000B00000400010000FF006F24BB'
const STEAM_SAFE =
    'AAFFD20A006000034D000100EC004E002503010101FF000101030203000100006301010102010100010202000B00000400010000FF00002503010101FF000101030203000100006301010102010100010203000B00000400010000FF00115DBB'
const VERY_BRIGHT =
    'AAFFD20A00600004C7000100EC004E002503010101FF000101030203000200006301010103010100010303000B00000400010000FF00002503010101FF000101030203000100006301010103010100010303000B00000400010000FF00DA2FBB'
const DUST_MELODY_BUTTERFLY =
    'AAFFD20A00600003FD000100EC004E002503010101FF000101010203000100006301010102010100010203000B00000400010000FF00002503010101FF000101010203000100006301010103010100010203000B00000400010000FF00A76BBB'
const CHARGING_MELODY_NEBULA =
    'AAFFD20A00600005BC000100EC004E002504010101FF000101030403000100006401010103010100010303000B00000400010000FF00002504010101FF000101030503000100006401010103010100010303000B00000400010000FF00776FBB'
const BUTTON_SOUND_MUTE =
    'AAFFD20A006000060E000100EC004E002504010101FF000101030503000100006401010103010100010303000B00000100010000FF00002504010101FF000101030503000100006401010103010100010303000B00000400010000FF00A5C7BB'
const BATTERY_LIFE_EXTENSION_ON =
    'AAFFD20A0060000622000100EC004E002504010101FF000101030503000100006401010103010100010303000B00000400010000FF00002504010101FF000101030503000100006401020103010100010303000B00000400010000FF003DC8BB'
const BATTERY_LIFE_EXTENSION_OFF =
    'AAFFD20A0060000636000100EC004E002504010101FF000101030503000100006401020103010100010303000B00000400010000FF00002504010101FF000101030503000100006401010103010100010303000B00000400010000FF007812BB'

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe('HWWA9XC_F2U', () => {
    test('publishes the captured stick-cleaner components', () => {
        const { ha } = makeDevice()
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>

        assert.equal(components.current_state.platform, 'sensor')
        assert.equal(components.operation_mode.platform, 'sensor')
        assert.equal(components.suction_power.platform, 'select')
        assert.equal(components.mop_mode.platform, 'select')
        assert.equal(components.water_supply.platform, 'select')
        assert.equal(components.steam_mode.platform, 'select')
        assert.equal(components.display_brightness.platform, 'select')
        assert.equal(components.dust_empty_melody.platform, 'select')
        assert.equal(components.charging_alert_volume.platform, 'select')
        assert.equal(components.charging_melody.platform, 'select')
        assert.equal(components.button_sound.platform, 'select')
        assert.equal(components.battery_life_extension.platform, 'switch')
        assert.equal(components.battery.device_class, 'battery')
        assert.equal(components.auto_empty.platform, 'switch')
        assert.equal(components.empty_bin.platform, 'button')
        assert.equal(components.protocol_status.entity_category, 'diagnostic')

        assert.deepEqual(
            Object.fromEntries(
                [
                    'suction_power',
                    'mop_mode',
                    'water_supply',
                    'steam_mode',
                    'display_brightness',
                    'dust_empty_melody',
                    'charging_alert_volume',
                    'charging_melody',
                    'button_sound',
                    'battery_life_extension',
                    'auto_empty',
                    'empty_bin',
                ].map((key) => [key, components[key].name]),
            ),
            {
                suction_power: '청소 시작 흡입력',
                mop_mode: '기본 물걸레 흡입구 모드',
                water_supply: '기본 물공급 양',
                steam_mode: '기본 스팀 흡입구 모드',
                display_brightness: '충전 중 화면 밝기',
                dust_empty_melody: '먼지 비움 멜로디',
                charging_alert_volume: '충전 중 알림 소리',
                charging_melody: '충전 알림 멜로디',
                button_sound: '설정 버튼 알림음',
                battery_life_extension: '배터리 수명 연장 모드',
                auto_empty: '자동 먼지 비움',
                empty_bin: '먼지 비우기',
            },
        )

        assert.deepEqual(components.suction_power.options, ['저전력', '표준', '강', '터보'])
        assert.deepEqual(components.mop_mode.options, ['물걸레와 흡입 동시 사용', '물걸레만 사용'])
        assert.deepEqual(components.water_supply.options, ['1단계', '2단계'])
        assert.deepEqual(components.steam_mode.options, ['안심 스팀', '온수 물걸레'])
        assert.deepEqual(components.display_brightness.options, ['어둡게', '보통', '밝게', '매우 밝게'])
        assert.deepEqual(components.dust_empty_melody.options, ['이슬', '새싹', '나비'])
        assert.deepEqual(components.charging_alert_volume.options, ['작게', '보통', '크게'])
        assert.deepEqual(components.charging_melody.options, ['럭키', '구슬', '얼음', '산들 바람', '성운'])
        assert.deepEqual(components.button_sound.options, ['음소거', '작게', '보통', '크게'])
    })

    test('decodes the additional captured cleaning and charging settings', () => {
        const { ha, thinq } = makeDevice()

        thinq.emit('data', buf(LOW_POWER))
        assert.equal(ha.devices[DEVICE_ID].properties.suction_power, '저전력')

        thinq.emit('data', buf(MOP_AND_VACUUM))
        assert.equal(ha.devices[DEVICE_ID].properties.mop_mode, '물걸레와 흡입 동시 사용')

        thinq.emit('data', buf(WATER_LEVEL_2))
        assert.equal(ha.devices[DEVICE_ID].properties.water_supply, '2단계')

        thinq.emit('data', buf(STEAM_SAFE))
        assert.equal(ha.devices[DEVICE_ID].properties.steam_mode, '안심 스팀')

        thinq.emit('data', buf(VERY_BRIGHT))
        assert.equal(ha.devices[DEVICE_ID].properties.display_brightness, '매우 밝게')

        thinq.emit('data', buf(DUST_MELODY_BUTTERFLY))
        assert.equal(ha.devices[DEVICE_ID].properties.dust_empty_melody, '나비')

        thinq.emit('data', buf(CHARGING_MELODY_NEBULA))
        assert.equal(ha.devices[DEVICE_ID].properties.charging_alert_volume, '작게')
        assert.equal(ha.devices[DEVICE_ID].properties.charging_melody, '성운')

        thinq.emit('data', buf(BUTTON_SOUND_MUTE))
        assert.equal(ha.devices[DEVICE_ID].properties.button_sound, '음소거')
    })

    test('decodes and controls the captured battery life extension mode', () => {
        const { ha, thinq, dev } = makeDevice()

        thinq.emit('data', buf(BATTERY_LIFE_EXTENSION_ON))
        assert.equal(ha.devices[DEVICE_ID].properties.battery_life_extension, 'ON')

        thinq.emit('data', buf(BATTERY_LIFE_EXTENSION_OFF))
        assert.equal(ha.devices[DEVICE_ID].properties.battery_life_extension, 'OFF')

        dev.setProperty('battery_life_extension', 'ON')
        dev.setProperty('battery_life_extension', 'OFF')
        assert.deepEqual(thinq.outbox.map(hex), ['AA09F02407010284BB', 'AA09F02407010185BB'])
    })

    test('decodes charged, running, and charging transitions captured through ThinQ', () => {
        const { ha, thinq } = makeDevice()

        thinq.emit('data', buf(CHARGED))
        assert.equal(ha.devices[DEVICE_ID].properties.current_state, 'CHARGED')
        assert.equal(ha.devices[DEVICE_ID].properties.operation_mode, 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties.battery, 99)

        thinq.emit('data', buf(RUNNING))
        assert.equal(ha.devices[DEVICE_ID].properties.current_state, 'RUNNING')
        assert.equal(ha.devices[DEVICE_ID].properties.operation_mode, 'NORMAL')
        assert.equal(ha.devices[DEVICE_ID].properties.battery, 98)

        thinq.emit('data', buf(CHARGING))
        assert.equal(ha.devices[DEVICE_ID].properties.current_state, 'CHARGING')
        assert.equal(ha.devices[DEVICE_ID].properties.operation_mode, 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties.battery, 98)
    })

    test('decodes automatic dust emptying from captured ON and OFF reports', () => {
        const { ha, thinq } = makeDevice()

        thinq.emit('data', buf(AUTO_EMPTY_ON))
        assert.equal(ha.devices[DEVICE_ID].properties.auto_empty, 'ON')

        thinq.emit('data', buf(AUTO_EMPTY_OFF))
        assert.equal(ha.devices[DEVICE_ID].properties.auto_empty, 'OFF')
    })

    test('sends captured automatic-empty and manual-empty commands', () => {
        const { thinq, dev } = makeDevice()

        dev.setProperty('auto_empty', 'ON')
        dev.setProperty('auto_empty', 'OFF')
        dev.setProperty('empty_bin', 'PRESS')

        assert.deepEqual(thinq.outbox.map(hex), ['AA09F02408010287BB', 'AA09F02408010184BB', 'AA09F0240A010281BB'])
    })

    test('sends every additional captured settings command', () => {
        const { thinq, dev } = makeDevice()

        dev.setProperty('suction_power', '저전력')
        dev.setProperty('suction_power', '표준')
        dev.setProperty('suction_power', '강')
        dev.setProperty('suction_power', '터보')
        dev.setProperty('mop_mode', '물걸레와 흡입 동시 사용')
        dev.setProperty('mop_mode', '물걸레만 사용')
        dev.setProperty('water_supply', '1단계')
        dev.setProperty('water_supply', '2단계')
        dev.setProperty('steam_mode', '안심 스팀')
        dev.setProperty('steam_mode', '온수 물걸레')
        dev.setProperty('display_brightness', '어둡게')
        dev.setProperty('display_brightness', '보통')
        dev.setProperty('display_brightness', '밝게')
        dev.setProperty('display_brightness', '매우 밝게')
        dev.setProperty('dust_empty_melody', '이슬')
        dev.setProperty('dust_empty_melody', '새싹')
        dev.setProperty('dust_empty_melody', '나비')
        dev.setProperty('charging_alert_volume', '작게')
        dev.setProperty('charging_alert_volume', '보통')
        dev.setProperty('charging_alert_volume', '크게')
        dev.setProperty('charging_melody', '럭키')
        dev.setProperty('charging_melody', '구슬')
        dev.setProperty('charging_melody', '얼음')
        dev.setProperty('charging_melody', '산들 바람')
        dev.setProperty('charging_melody', '성운')
        dev.setProperty('button_sound', '음소거')
        dev.setProperty('button_sound', '작게')
        dev.setProperty('button_sound', '보통')
        dev.setProperty('button_sound', '크게')

        assert.deepEqual(thinq.outbox.map(hex), [
            'AA09F0240201049BBB',
            'AA09F0240201019EBB',
            'AA09F02402010299BB',
            'AA09F02402010398BB',
            'AA09F0240101029EBB',
            'AA09F0240101019FBB',
            'AA09F0240C010283BB',
            'AA09F0240C010382BB',
            'AA09F0240D01038DBB',
            'AA09F0240D010282BB',
            'AA09F02405010484BB',
            'AA09F02405010385BB',
            'AA09F0240501029ABB',
            'AA09F0240501019BBB',
            'AA09F02409010187BB',
            'AA09F02409010286BB',
            'AA09F02409010381BB',
            'AA09F0240401039ABB',
            'AA09F0240401029BBB',
            'AA09F02404010198BB',
            'AA09F02403010199BB',
            'AA09F02403010298BB',
            'AA09F0240301039BBB',
            'AA09F0240301049ABB',
            'AA09F02403010585BB',
            'AA09F0240F01048EBB',
            'AA09F0240F01038FBB',
            'AA09F0240F01028CBB',
            'AA09F0240F01018DBB',
        ])
    })

    test('uses the final status record and classifies only recognized packets as mapped', () => {
        const { thinq } = makeDevice()
        const classifications: boolean[] = []
        thinq.on('packetData', (_packet, mapped) => classifications.push(mapped))

        thinq.receivePacket(buf(RUNNING))
        thinq.receivePacket(buf('AA08D2002400FDBB'))

        assert.deepEqual(classifications, [true, false])
    })
})

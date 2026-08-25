import HADevice from './base'
import AABBDevice from './aabb_device'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import { displayValueTemplate } from './display_localization'

const STATUS_DATA_LENGTH = 0x25

const STATES: Record<number, string> = {
    0x00: 'OFF',
    0x01: 'INITIAL',
    0x02: 'RUNNING',
    0x03: 'CHARGING',
    0x04: 'CHARGED',
    0x05: 'IDLE',
}

const JOB_MODES: Record<number, string> = {
    0x01: 'OFF',
    0x03: 'NORMAL',
}

const DISPLAY_LABELS = {
    OFF: '꺼짐',
    INITIAL: '초기화',
    RUNNING: '작동 중',
    CHARGING: '충전 중',
    CHARGED: '충전 완료',
    IDLE: '대기',
    NORMAL: '표준',
}

const SUCTION_POWER: Record<number, string> = {
    0x01: '표준',
    0x02: '강',
    0x03: '터보',
    0x04: '저전력',
}

const MOP_MODES: Record<number, string> = {
    0x01: '물걸레만 사용',
    0x02: '물걸레와 흡입 동시 사용',
}

const WATER_SUPPLY: Record<number, string> = {
    0x02: '1단계',
    0x03: '2단계',
}

const STEAM_MODES: Record<number, string> = {
    0x02: '온수 물걸레',
    0x03: '안심 스팀',
}

const DISPLAY_BRIGHTNESS: Record<number, string> = {
    0x01: '매우 밝게',
    0x02: '밝게',
    0x03: '보통',
    0x04: '어둡게',
}

const DUST_EMPTY_MELODIES: Record<number, string> = {
    0x01: '이슬',
    0x02: '새싹',
    0x03: '나비',
}

const CHARGING_ALERT_VOLUMES: Record<number, string> = {
    0x01: '크게',
    0x02: '보통',
    0x03: '작게',
}

const CHARGING_MELODIES: Record<number, string> = {
    0x01: '럭키',
    0x02: '구슬',
    0x03: '얼음',
    0x04: '산들 바람',
    0x05: '성운',
}

const BUTTON_SOUNDS: Record<number, string> = {
    0x01: '크게',
    0x02: '보통',
    0x03: '작게',
    0x04: '음소거',
}

const SELECT_COMMANDS: Record<string, { command: number; values: Record<string, number> }> = {
    suction_power: { command: 0x02, values: invert(SUCTION_POWER) },
    mop_mode: { command: 0x01, values: invert(MOP_MODES) },
    water_supply: { command: 0x0c, values: invert(WATER_SUPPLY) },
    steam_mode: { command: 0x0d, values: invert(STEAM_MODES) },
    display_brightness: { command: 0x05, values: invert(DISPLAY_BRIGHTNESS) },
    dust_empty_melody: { command: 0x09, values: invert(DUST_EMPTY_MELODIES) },
    charging_alert_volume: { command: 0x04, values: invert(CHARGING_ALERT_VOLUMES) },
    charging_melody: { command: 0x03, values: invert(CHARGING_MELODIES) },
    button_sound: { command: 0x0f, values: invert(BUTTON_SOUNDS) },
}

function invert(values: Record<number, string>) {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [value, Number(key)]))
}

function formatEnum(values: Record<number, string>, value: number) {
    return values[value] ?? `UNKNOWN_0x${value.toString(16).padStart(2, '0').toUpperCase()}`
}

/**
 * Korean CordZero stick cleaner (ThinQ model HWWA9XC_F2U).
 *
 * The device wraps its 0x00EC status response in the extended D2 envelope.
 * The response contains one or two tagged 0x0025 records; when two are
 * present, the final record is the current state and the first is the
 * previous state. Off-dock, running, stopped, and re-docked transitions were
 * captured through the official LG ThinQ app on 2026-08-24.
 */
export default class Device extends AABBDevice {
    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: '스틱청소기' }),
                components: {
                    current_state: {
                        platform: 'sensor',
                        unique_id: '$deviceid-current-state',
                        state_topic: '$this/current_state',
                        name: '현재 상태',
                        icon: 'mdi:vacuum-outline',
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    operation_mode: {
                        platform: 'sensor',
                        unique_id: '$deviceid-operation-mode',
                        state_topic: '$this/operation_mode',
                        name: '작동 모드',
                        icon: 'mdi:vacuum',
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    suction_power: {
                        platform: 'select',
                        unique_id: '$deviceid-suction-power',
                        state_topic: '$this/suction_power',
                        command_topic: '$this/suction_power/set',
                        options: ['저전력', '표준', '강', '터보'],
                        name: '청소 시작 흡입력',
                        icon: 'mdi:fan-speed-3',
                        entity_category: 'config',
                    },
                    mop_mode: {
                        platform: 'select',
                        unique_id: '$deviceid-mop-mode',
                        state_topic: '$this/mop_mode',
                        command_topic: '$this/mop_mode/set',
                        options: ['물걸레와 흡입 동시 사용', '물걸레만 사용'],
                        name: '기본 물걸레 흡입구 모드',
                        icon: 'mdi:water-opacity',
                        entity_category: 'config',
                    },
                    water_supply: {
                        platform: 'select',
                        unique_id: '$deviceid-water-supply',
                        state_topic: '$this/water_supply',
                        command_topic: '$this/water_supply/set',
                        options: ['1단계', '2단계'],
                        name: '기본 물공급 양',
                        icon: 'mdi:water-plus',
                        entity_category: 'config',
                    },
                    steam_mode: {
                        platform: 'select',
                        unique_id: '$deviceid-steam-mode',
                        state_topic: '$this/steam_mode',
                        command_topic: '$this/steam_mode/set',
                        options: ['안심 스팀', '온수 물걸레'],
                        name: '기본 스팀 흡입구 모드',
                        icon: 'mdi:heat-wave',
                        entity_category: 'config',
                    },
                    display_brightness: {
                        platform: 'select',
                        unique_id: '$deviceid-display-brightness',
                        state_topic: '$this/display_brightness',
                        command_topic: '$this/display_brightness/set',
                        options: ['어둡게', '보통', '밝게', '매우 밝게'],
                        name: '충전 중 화면 밝기',
                        icon: 'mdi:brightness-6',
                        entity_category: 'config',
                    },
                    dust_empty_melody: {
                        platform: 'select',
                        unique_id: '$deviceid-dust-empty-melody',
                        state_topic: '$this/dust_empty_melody',
                        command_topic: '$this/dust_empty_melody/set',
                        options: ['이슬', '새싹', '나비'],
                        name: '먼지 비움 멜로디',
                        icon: 'mdi:music-note',
                        entity_category: 'config',
                    },
                    charging_alert_volume: {
                        platform: 'select',
                        unique_id: '$deviceid-charging-alert-volume',
                        state_topic: '$this/charging_alert_volume',
                        command_topic: '$this/charging_alert_volume/set',
                        options: ['작게', '보통', '크게'],
                        name: '충전 중 알림 소리',
                        icon: 'mdi:volume-high',
                        entity_category: 'config',
                    },
                    charging_melody: {
                        platform: 'select',
                        unique_id: '$deviceid-charging-melody',
                        state_topic: '$this/charging_melody',
                        command_topic: '$this/charging_melody/set',
                        options: ['럭키', '구슬', '얼음', '산들 바람', '성운'],
                        name: '충전 알림 멜로디',
                        icon: 'mdi:music-note-eighth',
                        entity_category: 'config',
                    },
                    button_sound: {
                        platform: 'select',
                        unique_id: '$deviceid-button-sound',
                        state_topic: '$this/button_sound',
                        command_topic: '$this/button_sound/set',
                        options: ['음소거', '작게', '보통', '크게'],
                        name: '설정 버튼 알림음',
                        icon: 'mdi:volume-medium',
                        entity_category: 'config',
                    },
                    battery: {
                        platform: 'sensor',
                        unique_id: '$deviceid-battery',
                        state_topic: '$this/battery',
                        name: '배터리',
                        device_class: 'battery',
                        state_class: 'measurement',
                        unit_of_measurement: '%',
                    },
                    auto_empty: {
                        platform: 'switch',
                        unique_id: '$deviceid-auto-empty',
                        state_topic: '$this/auto_empty',
                        command_topic: '$this/auto_empty/set',
                        name: '자동 먼지 비움',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:delete-empty',
                    },
                    empty_bin: {
                        platform: 'button',
                        unique_id: '$deviceid-empty-bin',
                        command_topic: '$this/empty_bin/set',
                        name: '먼지 비우기',
                        icon: 'mdi:delete-empty-outline',
                    },
                    battery_life_extension: {
                        platform: 'switch',
                        unique_id: '$deviceid-battery-life-extension',
                        state_topic: '$this/battery_life_extension',
                        command_topic: '$this/battery_life_extension/set',
                        name: '배터리 수명 연장 모드',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:battery-heart-variant',
                        entity_category: 'config',
                    },
                    protocol_status: {
                        platform: 'sensor',
                        unique_id: '$deviceid-protocol-status',
                        state_topic: '$this/protocol_status',
                        name: '프로토콜 상태',
                        icon: 'mdi:code-json',
                        entity_category: 'diagnostic',
                    },
                },
            }),
        )
    }

    processAABB(buf: Buffer) {
        if (buf[0] !== 0xd2 || buf[1] !== 0x0a) return

        // The compact 0x004C report carries the automatic dust-emptying flag.
        // Captures taken immediately after the official app's ON/OFF commands
        // differ at this byte (1=ON, 0=OFF), excluding sequence and checksum.
        if (buf[3] === 0x4c && buf.length >= 65) {
            this.publishProperty('auto_empty', buf[64] ? 'ON' : 'OFF')
            return
        }

        const command = buf.indexOf(Buffer.from([0x00, 0xec]))
        if (command < 0 || command + 4 > buf.length) return

        const statuses = this.statusBlocks(buf.subarray(command + 4))
        const current = statuses[statuses.length - 1]
        if (current) this.publishStatus(current)
    }

    private statusBlocks(payload: Buffer) {
        const statuses: Buffer[] = []
        let offset = 0

        while (offset + 2 <= payload.length) {
            const tag = payload[offset]
            const length = payload[offset + 1]
            const end = offset + 2 + length
            if (end > payload.length) break

            if (tag === 0x00 && length === STATUS_DATA_LENGTH) statuses.push(payload.subarray(offset, end))
            offset = end
        }

        return statuses
    }

    private publishStatus(status: Buffer) {
        if (status.length !== STATUS_DATA_LENGTH + 2 || status[0] !== 0x00 || status[1] !== STATUS_DATA_LENGTH) return

        const data = status.subarray(2)
        const battery = Math.max(0, Math.min(100, data[15]))

        this.publishProperty('protocol_status', status.toString('hex').toUpperCase())
        this.publishProperty('current_state', formatEnum(STATES, data[0]))
        this.publishProperty('operation_mode', formatEnum(JOB_MODES, data[1]))
        this.publishMapped('suction_power', SUCTION_POWER, data[8])
        this.publishMapped('mop_mode', MOP_MODES, data[6])
        this.publishMapped('water_supply', WATER_SUPPLY, data[24])
        this.publishMapped('steam_mode', STEAM_MODES, data[25])
        this.publishMapped('display_brightness', DISPLAY_BRIGHTNESS, data[12])
        this.publishMapped('dust_empty_melody', DUST_EMPTY_MELODIES, data[19])
        this.publishMapped('charging_alert_volume', CHARGING_ALERT_VOLUMES, data[10])
        this.publishMapped('charging_melody', CHARGING_MELODIES, data[9])
        this.publishMapped('button_sound', BUTTON_SOUNDS, data[30])
        if (data[17] === 0x01 || data[17] === 0x02) {
            this.publishProperty('battery_life_extension', data[17] === 0x02 ? 'ON' : 'OFF')
        }
        this.publishProperty('battery', battery)
    }

    private publishMapped(prop: string, values: Record<number, string>, value: number) {
        const mapped = values[value]
        if (mapped) this.publishProperty(prop, mapped)
    }

    setProperty(prop: string, value: string) {
        if (prop === 'auto_empty') {
            this.send(Buffer.from(value === 'ON' ? 'F024080102' : 'F024080101', 'hex'))
        } else if (prop === 'empty_bin') {
            this.send(Buffer.from('F0240A0102', 'hex'))
        } else if (prop === 'battery_life_extension') {
            this.send(Buffer.from(value === 'ON' ? 'F024070102' : 'F024070101', 'hex'))
        } else {
            const select = SELECT_COMMANDS[prop]
            const encoded = select?.values[value]
            if (select && encoded !== undefined) this.send(Buffer.from([0xf0, 0x24, select.command, 0x01, encoded]))
        }
    }
}

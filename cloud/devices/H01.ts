import HADevice from './base'
import AABBDevice from './aabb_device'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import { commandValueTemplate, displayOptions, displayValueTemplate } from './display_localization'

const STATUS_DATA_LENGTH = 24

const STATES: Record<number, string> = {
    0x00: 'OFF',
    0x01: 'INITIAL',
    0x02: 'RUNNING',
    0x03: 'PAUSE',
    // H01 reports 0x04 while its panel power is off. ThinQ exposes the same
    // state as POWER_OFF, so keep the user-facing value consistent with the
    // power entity instead of presenting an ambiguous standby state.
    0x04: 'OFF',
}
const COURSES: Record<number, string> = {
    0x00: 'OFF',
    0x01: 'AUTO',
    0x02: 'HEAVY',
    0x05: 'NORMAL',
    0x06: 'DOWNLOAD',
    0x09: 'TUB_CLEAN',
    0x0f: 'DRY_ONLY',
    0x10: 'NIGHT_SILENT',
}

const REMOTE_COURSES: Record<string, number> = {
    AUTO: 0x01,
    ONE_HOUR: 0x12,
    DOWNLOAD_CYCLE: 0x0b,
}

const BUZZER_OPTIONS = ['OFF', 'LOW', 'HIGH']
const REMOTE_MODE_OPTIONS = ['OFF', 'ONE_TIME', 'ALWAYS']

const DOWNLOADED_COURSES: Record<number, string> = {
    0x02: 'POTS_AND_PANS',
    0x03: 'GLASS_AND_WINE',
    0x04: 'GRILLED_DISHES',
    0x05: 'GREASY_DISHES',
    0x06: 'BAKED_ON_DISHES',
    0x07: 'FISH_DISHES',
    0x08: 'DELICATE',
    0x0a: 'RINSE_ONLY',
    0x0d: 'MACHINE_CLEAN',
    0x0f: 'PLASTIC_DISHES',
}
const DOWNLOADED_COURSE_OPTIONS = ['NONE', ...Object.values(DOWNLOADED_COURSES)]

const DISPLAY_LABELS = {
    NONE: '선택 안 함',
    POTS_AND_PANS: '냄비와 팬',
    GLASS_AND_WINE: '유리잔과 와인잔',
    GRILLED_DISHES: '구이 요리',
    GREASY_DISHES: '기름진 식기',
    BAKED_ON_DISHES: '눌어붙은 식기',
    FISH_DISHES: '생선 요리',
    DELICATE: '섬세 식기',
    RINSE_ONLY: '헹굼 전용',
    MACHINE_CLEAN: '기계 세척',
    PLASTIC_DISHES: '플라스틱 식기',
    OFF: '꺼짐',
    ONE_TIME: '한 번',
    ALWAYS: '항상',
    LOW: '작게',
    HIGH: '크게',
    AUTO: '자동',
    ONE_HOUR: '1시간',
    DOWNLOAD_CYCLE: '다운로드 코스',
    DOWNLOAD: '다운로드',
    TUB_CLEAN: '통살균',
    HEAVY: '강력',
    NORMAL: '표준',
    DRY_ONLY: '건조단독',
    NIGHT_SILENT: '야간조용',
    UPPER: '상단',
    LOWER: '하단',
    ALL: '전체',
    UNKNOWN: '알 수 없음',
    MIN_40: '40분',
    MIN_60: '60분',
    MIN_90: '90분',
    WASHING: '세척 중',
    RINSING: '헹굼 중',
}

const OPERATION_LABELS = { start: '시작', stop: '정지', cancel: '취소', power_off: '전원 끄기' }

const DIAGNOSTIC_STAGES: Record<number, string> = {
    0x02: 'WASHING',
    0x03: 'RINSING',
}

function formatEnum(values: Record<number, string>, value: number) {
    return values[value] ?? `UNKNOWN_0x${value.toString(16).padStart(2, '0').toUpperCase()}`
}

/**
 * Korean H01 dishwasher (ThinQ device type 204).
 *
 * Status frames use tagged blocks. Tag 0x00 with length 0x18 contains the
 * 24-byte operating state, while tag 0x05 contains statistics that are ignored.
 * A 0x32ec update can contain previous and current states; the final 0x0018
 * block is current. Controls follow the verified H11 device-type-204 mapping.
 * Model-specific Steam fields are intentionally excluded until independently
 * verified from both ON and OFF control captures.
 */
export default class Device extends AABBDevice {
    private settings = {
        rinse: 0,
        salt: 0,
        opt1: 0x90,
        opt2: 0xc2,
        opt3: 0,
    }
    private hasStatus = false
    private remoteStart = {
        course: REMOTE_COURSES.AUTO,
        delay: 0,
        extraRinse: 0,
    }
    private remainingTarget?: { minutes: number; timestamp: string }

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: '식기세척기' }),
                components: {
                    state: {
                        platform: 'sensor',
                    } as unknown as DeviceDiscovery['components'][string],
                    course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-course',
                        state_topic: '$this/course',
                        name: '코스',
                        icon: 'mdi:dishwasher',
                        device_class: 'enum',
                        options: displayOptions(Object.values(COURSES), DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    steam: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-steam',
                        state_topic: '$this/steam',
                        name: '스팀',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:steam',
                    },
                    intensive_wash: {
                        platform: 'sensor',
                        unique_id: '$deviceid-intensive-wash',
                        state_topic: '$this/intensive_wash',
                        name: '집중세척',
                        icon: 'mdi:spray-bottle',
                        device_class: 'enum',
                        options: displayOptions(['UPPER', 'LOWER', 'ALL', 'UNKNOWN'], DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    safe_rinse: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-safe-rinse',
                        state_topic: '$this/safe_rinse',
                        name: '안심헹굼',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:water-check',
                    },
                    hot_air_dry: {
                        platform: 'sensor',
                        unique_id: '$deviceid-hot-air-dry',
                        state_topic: '$this/hot_air_dry',
                        name: '열풍건조',
                        icon: 'mdi:weather-windy',
                        device_class: 'enum',
                        options: displayOptions(['OFF', 'MIN_40', 'MIN_60', 'MIN_90'], DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    initial_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-initial-time',
                        state_topic: '$this/initial_time',
                        name: '전체 시간',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                    },
                    remaining_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-remaining-time',
                        state_topic: '$this/remaining_time',
                        name: '남은 시간',
                        device_class: 'timestamp',
                    },
                    tub_clean_count: {
                        platform: 'sensor',
                        unique_id: '$deviceid-tub-clean-count',
                        state_topic: '$this/tub_clean_count',
                        name: '통살균 후 사용 횟수',
                        unit_of_measurement: '회',
                        state_class: 'measurement',
                        icon: 'mdi:counter',
                        entity_category: 'diagnostic',
                    },
                    filter_remaining: {
                        platform: 'sensor',
                        unique_id: '$deviceid-filter-remaining',
                        state_topic: '$this/filter_remaining',
                        name: '필터 잔량',
                        unit_of_measurement: '%',
                        state_class: 'measurement',
                        icon: 'mdi:air-filter',
                        entity_category: 'diagnostic',
                    },
                    delay_start: {
                        platform: 'sensor',
                        unique_id: '$deviceid-delay-start',
                        state_topic: '$this/delay_start',
                        name: '예약 시간',
                        device_class: 'duration',
                        unit_of_measurement: 'h',
                    },
                    rinse_level: {
                        platform: 'number',
                        unique_id: '$deviceid-rinse-level',
                        state_topic: '$this/rinse_level',
                        command_topic: '$this/rinse_level/set',
                        name: '린스 투입량',
                        entity_category: 'config',
                        min: 0,
                        max: 4,
                        step: 1,
                        icon: 'mdi:cup-water',
                    },
                    salt_level: {
                        platform: 'number',
                        unique_id: '$deviceid-salt-level',
                        state_topic: '$this/salt_level',
                        command_topic: '$this/salt_level/set',
                        name: '물 경도',
                        entity_category: 'config',
                        min: 0,
                        max: 4,
                        step: 1,
                        icon: 'mdi:shaker-outline',
                    },
                    extra_rinse: {
                        platform: 'sensor',
                        unique_id: '$deviceid-extra-rinse',
                        state_topic: '$this/extra_rinse',
                        name: '추가 헹굼',
                        unit_of_measurement: 'times',
                        icon: 'mdi:water-plus',
                    },
                    downloaded_course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-downloaded-course',
                        state_topic: '$this/downloaded_course',
                        name: '다운로드 코스',
                        icon: 'mdi:download',
                        device_class: 'enum',
                        options: displayOptions(DOWNLOADED_COURSE_OPTIONS, DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    remote_mode: {
                        platform: 'select',
                        unique_id: '$deviceid-remote-mode',
                        state_topic: '$this/remote_mode',
                        command_topic: '$this/remote_mode/set',
                        options: displayOptions(REMOTE_MODE_OPTIONS, DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                        command_template: commandValueTemplate(DISPLAY_LABELS),
                        name: '원격 제어 모드',
                        entity_category: 'config',
                        icon: 'mdi:remote',
                    },
                    door: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-door',
                        state_topic: '$this/door',
                        name: '문',
                        device_class: 'door',
                        payload_on: 'OPEN',
                        payload_off: 'CLOSED',
                    },
                    clean_reminder: {
                        platform: 'switch',
                        unique_id: '$deviceid-clean-reminder',
                        state_topic: '$this/clean_reminder',
                        command_topic: '$this/clean_reminder/set',
                        name: '기계 청소 알림',
                        entity_category: 'config',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:lightbulb-on-outline',
                    },
                    extra_dry: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-extra-dry',
                        state_topic: '$this/extra_dry',
                        name: '추가 건조',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:heat-wave',
                    },
                    high_temp: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-high-temp',
                        state_topic: '$this/high_temp',
                        name: '고온',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:thermometer-high',
                    },
                    remote_start_active: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-remote-start-active',
                        state_topic: '$this/remote_start_active',
                        name: '원격 제어 가능',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:remote',
                    },
                    end_alarm: {
                        platform: 'switch',
                        unique_id: '$deviceid-end-alarm',
                        state_topic: '$this/end_alarm',
                        command_topic: '$this/end_alarm/set',
                        name: '종료 알림',
                        entity_category: 'config',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:bell-ring-outline',
                    },
                    buzzer: {
                        platform: 'select',
                        unique_id: '$deviceid-buzzer',
                        state_topic: '$this/buzzer',
                        command_topic: '$this/buzzer/set',
                        options: displayOptions(BUZZER_OPTIONS, DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                        command_template: commandValueTemplate(DISPLAY_LABELS),
                        name: '차임 소리',
                        entity_category: 'config',
                        icon: 'mdi:volume-high',
                    },
                    power: {
                        platform: 'switch',
                        unique_id: '$deviceid-power',
                        state_topic: '$this/power',
                        command_topic: '$this/power/set',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        name: '전원',
                        icon: 'mdi:power',
                    },
                    operation: {
                        platform: 'select',
                        unique_id: '$deviceid-operation',
                        command_topic: '$this/operation/set',
                        options: displayOptions(Object.keys(OPERATION_LABELS), OPERATION_LABELS),
                        command_template: commandValueTemplate(OPERATION_LABELS),
                        name: '운전',
                        icon: 'mdi:play-pause',
                    },
                    pause: {
                        platform: 'button',
                        unique_id: '$deviceid-pause',
                        command_topic: '$this/pause/set',
                        payload_press: '',
                        name: '일시정지',
                        icon: 'mdi:pause-circle-outline',
                    },
                    resume: {
                        platform: 'button',
                        unique_id: '$deviceid-resume',
                        command_topic: '$this/resume/set',
                        payload_press: '',
                        name: '계속',
                        icon: 'mdi:play-circle-outline',
                    },
                    cancel: {
                        platform: 'button',
                        unique_id: '$deviceid-cancel',
                        command_topic: '$this/cancel/set',
                        payload_press: '',
                        name: '코스 취소',
                        icon: 'mdi:stop-circle-outline',
                    },
                    remote_course: {
                        platform: 'select',
                        unique_id: '$deviceid-remote-course',
                        state_topic: '$this/remote_course',
                        command_topic: '$this/remote_course/set',
                        options: displayOptions(Object.keys(REMOTE_COURSES), DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                        command_template: commandValueTemplate(DISPLAY_LABELS),
                        optimistic: true,
                        name: '원격 시작 코스',
                        icon: 'mdi:dishwasher',
                    },
                    remote_delay: {
                        platform: 'number',
                        unique_id: '$deviceid-remote-delay',
                        state_topic: '$this/remote_delay',
                        command_topic: '$this/remote_delay/set',
                        min: 0,
                        max: 12,
                        step: 1,
                        unit_of_measurement: 'h',
                        optimistic: true,
                        name: '원격 예약 시간',
                        icon: 'mdi:timer-outline',
                    },
                    remote_extra_rinse: {
                        platform: 'number',
                        unique_id: '$deviceid-remote-extra-rinse',
                        state_topic: '$this/remote_extra_rinse',
                        command_topic: '$this/remote_extra_rinse/set',
                        min: 0,
                        max: 3,
                        step: 1,
                        optimistic: true,
                        name: '원격 추가 헹굼',
                        icon: 'mdi:water-plus',
                    },
                    remote_start: {
                        platform: 'button',
                        unique_id: '$deviceid-remote-start',
                        command_topic: '$this/remote_start/set',
                        payload_press: '',
                        name: '원격 시작',
                        icon: 'mdi:play-circle-outline',
                    },
                    energy_delta: {
                        platform: 'sensor',
                        unique_id: '$deviceid-energy-delta',
                        state_topic: '$this/energy_delta',
                        name: '최근 사용 전력량',
                        device_class: 'energy',
                        state_class: 'measurement',
                        unit_of_measurement: 'Wh',
                    },
                    energy_total: {
                        platform: 'sensor',
                        unique_id: '$deviceid-energy-total',
                        state_topic: '$this/energy_total',
                        name: '코스 사용 전력량',
                        device_class: 'energy',
                        state_class: 'measurement',
                        unit_of_measurement: 'Wh',
                    },
                    diagnostic_stage: {
                        platform: 'sensor',
                        unique_id: '$deviceid-diagnostic-stage',
                        state_topic: '$this/diagnostic_stage',
                        name: '진단 단계',
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                        entity_category: 'diagnostic',
                        icon: 'mdi:progress-wrench',
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
            {
                // Recreate these sensors once so existing MQTT entities pick
                // up their enum device class and option lists.
                state: { platform: 'sensor' },
                course: { platform: 'sensor' },
                downloaded_course: { platform: 'sensor' },
                intensive_wash: { platform: 'sensor' },
                hot_air_dry: { platform: 'sensor' },
                remaining_time: { platform: 'sensor' },
                initial_time: { platform: 'sensor' },
                rinse_level: { platform: 'number' },
                salt_level: { platform: 'number' },
                remote_mode: { platform: 'select' },
                clean_reminder: { platform: 'switch' },
                end_alarm: { platform: 'switch' },
                buzzer: { platform: 'select' },
                remote_steam: { platform: 'switch' },
                remote_high_temp: { platform: 'switch' },
                remote_extra_dry: { platform: 'switch' },
                brightness: { platform: 'select' },
                auto_dry: { platform: 'switch' },
            },
        )
    }

    start() {
        this.publishProperty('remote_course', 'AUTO')
        this.publishProperty('remote_delay', 0)
        this.publishProperty('remote_extra_rinse', 0)
        this.send(Buffer.from('F0ED1211010000010400', 'hex'))
    }

    processAABB(buf: Buffer) {
        if (buf[0] !== 0x32) return

        if (buf[1] === 0xeb || buf[1] === 0xec) {
            const statuses = this.statusBlocks(buf.subarray(2))
            const current = statuses[statuses.length - 1]
            if (current) this.publishStatus(current)
        } else if (buf[1] === 0x3e && buf.length === 7) {
            this.publishProperty('energy_delta', buf.readUInt16BE(2))
            this.publishProperty('energy_total', buf.readUInt16BE(4))
        } else if (buf[1] === 0xcf && buf.length === 115) {
            this.publishProperty('diagnostic_stage', formatEnum(DIAGNOSTIC_STAGES, buf[8]))
        }
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
        if (status.length !== 2 + STATUS_DATA_LENGTH || status[0] !== 0x00 || status[1] !== STATUS_DATA_LENGTH) return

        const data = status.subarray(2)
        const downloadedCourse = data[20]
        const course = formatEnum(COURSES, data[5])
        const state = data[0]
        const remoteMode = this.remoteMode(data[16])
        const buzzer = data[15] & 0x80 ? 'HIGH' : data[15] & 0x40 ? 'LOW' : 'OFF'

        this.settings.rinse = data[13]
        this.settings.salt = data[14]
        // H01 preserves two model flags (0x80 and 0x10) in every settings
        // command. They are present in all captured app writes and are not
        // represented by user-facing controls. Dropping them can overwrite
        // unrelated appliance configuration.
        this.settings.opt1 =
            0x90 |
            (data[16] & 0x04 ? 0x40 : 0) |
            (data[11] & 0x10 ? 0x20 : 0) |
            (data[11] & 0x40 ? 0x08 : 0) |
            (buzzer === 'HIGH' ? 0x04 : buzzer === 'LOW' ? 0x02 : 0)
        // Bit 0x02 is likewise fixed in every H01 app capture.
        this.settings.opt2 = (remoteMode === 'ALWAYS' ? 0x80 : remoteMode === 'ONE_TIME' ? 0x40 : 0xc0) | 0x02
        this.settings.opt3 = 0
        this.hasStatus = true

        this.publishProperty('protocol_status', status.toString('hex').toUpperCase())
        this.publishProperty('state', formatEnum(STATES, state))
        this.publishProperty('power', state === 0x01 || state === 0x02 || state === 0x03 ? 'ON' : 'OFF')
        this.publishProperty('course', course)
        this.publishProperty('steam', data[12] & 0x80 ? 'ON' : 'OFF')
        this.publishProperty('intensive_wash', this.intensiveWash(data[12]))
        this.publishProperty('safe_rinse', data[15] & 0x04 ? 'ON' : 'OFF')
        this.publishProperty('hot_air_dry', this.hotAirDry(data[15]))
        this.publishProperty(
            'initial_time',
            state === 0x01 || state === 0x02 || state === 0x03 ? data[3] * 60 + data[4] : '',
        )
        this.publishProperty('remaining_time', this.remainingTimestamp(data[7] * 60 + data[8], state))
        this.publishProperty('delay_start', data[9])
        this.publishProperty('door', data[11] & 0x02 ? 'OPEN' : 'CLOSED')
        this.publishProperty('clean_reminder', data[11] & 0x40 ? 'ON' : 'OFF')
        this.publishProperty('extra_dry', data[12] & 0x04 ? 'ON' : 'OFF')
        this.publishProperty('high_temp', data[12] & 0x08 ? 'ON' : 'OFF')
        this.publishProperty('rinse_level', data[13])
        this.publishProperty('salt_level', data[14])
        this.publishProperty('remote_start_active', data[15] & 0x02 ? 'ON' : 'OFF')
        this.publishProperty('remote_mode', remoteMode)
        this.publishProperty('end_alarm', data[16] & 0x04 ? 'ON' : 'OFF')
        this.publishProperty('buzzer', buzzer)
        // ThinQ Connect exposes this field as remainFreshAirFilterPercent.
        // The current cloud value (64%) matches H01 status byte 17 (0x40),
        // while the earlier captured status carries 0x41 (65%) here.
        this.publishProperty('filter_remaining', data[17])
        this.publishProperty(
            'downloaded_course',
            downloadedCourse ? formatEnum(DOWNLOADED_COURSES, downloadedCourse) : 'NONE',
        )
        this.publishProperty('extra_rinse', (data[21] & 0x30) >> 4)
        // The legacy ThinQ model names the final status byte TclCount. It is
        // the number of dishwasher uses since the last machine-clean cycle.
        this.publishProperty('tub_clean_count', data[23])
    }

    private remainingTimestamp(minutes: number, state: number) {
        if (minutes <= 0 || (state !== 0x01 && state !== 0x02 && state !== 0x03)) {
            this.remainingTarget = undefined
            return ''
        }
        if (this.remainingTarget?.minutes === minutes) return this.remainingTarget.timestamp
        const timestamp = new Date(Date.now() + minutes * 60_000).toISOString()
        this.remainingTarget = { minutes, timestamp }
        return timestamp
    }

    private remoteMode(value: number) {
        switch (value & 0xc0) {
            case 0x80:
                return 'ALWAYS'
            case 0x40:
                return 'ONE_TIME'
            case 0xc0:
                return 'OFF'
            default:
                return 'UNKNOWN'
        }
    }

    private intensiveWash(value: number) {
        switch (value & 0x60) {
            case 0x40:
                return 'UPPER'
            case 0x20:
                return 'LOWER'
            case 0x00:
                return 'ALL'
            default:
                return 'UNKNOWN'
        }
    }

    private hotAirDry(value: number) {
        switch (value & 0x30) {
            case 0x10:
                return 'MIN_40'
            case 0x20:
                return 'MIN_60'
            case 0x30:
                return 'MIN_90'
            default:
                return 'OFF'
        }
    }

    setProperty(prop: string, value: string) {
        if (prop === 'power') {
            this.send(Buffer.from(value === 'ON' ? 'F02616' : 'F02612', 'hex'))
        } else if (prop === 'operation') {
            const command = { start: 'F02614', stop: 'F02613', cancel: 'F02611', power_off: 'F02612' }[value]
            if (command) this.send(Buffer.from(command, 'hex'))
        } else if (prop === 'pause') {
            this.send(Buffer.from('F02613', 'hex'))
        } else if (prop === 'resume') {
            this.send(Buffer.from('F02614', 'hex'))
        } else if (prop === 'cancel') {
            this.send(Buffer.from('F02611', 'hex'))
        } else if (prop === 'rinse_level') {
            this.updateNumberSetting('rinse', value, 0, 4)
        } else if (prop === 'salt_level') {
            this.updateNumberSetting('salt', value, 0, 4)
        } else if (prop === 'clean_reminder') {
            this.updateSettingBit('opt1', 0x08, value === 'ON')
        } else if (prop === 'end_alarm') {
            this.updateSettingBit('opt1', 0x40, value === 'ON')
        } else if (prop === 'buzzer' && BUZZER_OPTIONS.includes(value)) {
            this.settings.opt1 = (this.settings.opt1 & ~0x06) | (value === 'HIGH' ? 0x04 : value === 'LOW' ? 0x02 : 0)
            this.sendSettings()
        } else if (prop === 'remote_mode' && REMOTE_MODE_OPTIONS.includes(value)) {
            this.settings.opt2 = (value === 'ALWAYS' ? 0x80 : value === 'ONE_TIME' ? 0x40 : 0xc0) | 0x02
            this.sendSettings()
        } else if (prop === 'remote_course' && value in REMOTE_COURSES) {
            this.remoteStart.course = REMOTE_COURSES[value]
            this.publishProperty(prop, value)
        } else if (prop === 'remote_delay') {
            this.remoteStart.delay = this.clampedInteger(value, 0, 12)
            this.publishProperty(prop, this.remoteStart.delay)
        } else if (prop === 'remote_extra_rinse') {
            this.remoteStart.extraRinse = this.clampedInteger(value, 0, 3)
            this.publishProperty(prop, this.remoteStart.extraRinse)
        } else if (prop === 'remote_start') {
            this.sendRemoteStart()
        }
    }

    private updateNumberSetting(setting: 'rinse' | 'salt', value: string, min: number, max: number) {
        this.settings[setting] = this.clampedInteger(value, min, max)
        this.sendSettings()
    }

    private updateSettingBit(setting: 'opt1' | 'opt3', mask: number, enabled: boolean) {
        this.settings[setting] = enabled ? this.settings[setting] | mask : this.settings[setting] & ~mask
        this.sendSettings()
    }

    private sendSettings() {
        if (!this.hasStatus) {
            console.warn('H01 settings command ignored until an initial status has been received')
            return
        }

        this.send(
            Buffer.from([
                0xf0,
                0x26,
                this.settings.rinse,
                this.settings.salt,
                this.settings.opt1,
                this.settings.opt2,
                this.settings.opt3,
                0x00,
                0x00,
                0x00,
            ]),
        )
    }

    private sendRemoteStart() {
        const rinse =
            (this.remoteStart.extraRinse * 0x08) |
            (this.remoteStart.course === REMOTE_COURSES.DOWNLOAD_CYCLE ? 0x40 : 0)

        this.send(
            Buffer.from([0xf0, 0x26, 0x10, this.remoteStart.course, this.remoteStart.delay, 0x00, 0x00, rinse, 0x00]),
        )
    }

    private clampedInteger(value: string, min: number, max: number) {
        const parsed = Number.parseInt(value, 10)
        if (!Number.isFinite(parsed)) return min
        return Math.max(min, Math.min(max, parsed))
    }
}

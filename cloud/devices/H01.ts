import HADevice from './base'
import AABBDevice from './aabb_device'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'

const STATUS_BLOCK_LENGTH = 26
const STATUS_DATA_LENGTH = 24

const STATES: Record<number, string> = {
    0x00: 'OFF',
    0x01: 'INITIAL',
    0x02: 'RUNNING',
    0x03: 'PAUSE',
    0x04: 'STANDBY',
}

const COURSES: Record<number, string> = {
    0x00: 'OFF',
    0x01: 'AUTO',
    0x0b: 'DOWNLOAD_CYCLE',
    0x12: 'ONE_HOUR',
}

const REMOTE_COURSES: Record<string, number> = {
    AUTO: 0x01,
    ONE_HOUR: 0x12,
    DOWNLOAD_CYCLE: 0x0b,
}

const BUZZER_OPTIONS = ['OFF', 'LOW', 'HIGH']
const REMOTE_MODE_OPTIONS = ['OFF', 'ONE_TIME', 'ALWAYS']
const BRIGHTNESS_OPTIONS = ['NORMAL', 'HIGH']

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
 * Status frames use 0x32eb for the initial state and 0x32ec for an
 * old/current pair. Each state block is tagged 0x0018 and contains 24 bytes.
 * Status fields come from appliance captures. Control frames follow the H11
 * device-type-204 analysis and are exposed for subsequent H01 validation.
 */
export default class Device extends AABBDevice {
    private settings = {
        rinse: 0,
        salt: 0,
        opt1: 0,
        opt2: 0xc0,
        opt3: 0,
    }
    private hasStatus = false
    private remoteStart = {
        course: REMOTE_COURSES.AUTO,
        delay: 0,
        steam: false,
        highTemp: false,
        extraDry: false,
        extraRinse: 0,
    }

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Dishwasher' }),
                components: {
                    state: {
                        platform: 'sensor',
                        unique_id: '$deviceid-state',
                        state_topic: '$this/state',
                        name: 'State',
                        icon: 'mdi:dishwasher',
                    },
                    course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-course',
                        state_topic: '$this/course',
                        name: 'Course',
                        icon: 'mdi:dishwasher',
                    },
                    initial_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-initial-time',
                        state_topic: '$this/initial_time',
                        name: 'Initial time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                    },
                    remaining_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-remaining-time',
                        state_topic: '$this/remaining_time',
                        name: 'Remaining time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                    },
                    delay_start: {
                        platform: 'sensor',
                        unique_id: '$deviceid-delay-start',
                        state_topic: '$this/delay_start',
                        name: 'Delay start',
                        device_class: 'duration',
                        unit_of_measurement: 'h',
                    },
                    rinse_level: {
                        platform: 'number',
                        unique_id: '$deviceid-rinse-level',
                        state_topic: '$this/rinse_level',
                        command_topic: '$this/rinse_level/set',
                        name: 'Rinse aid level',
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
                        name: 'Salt level',
                        min: 0,
                        max: 4,
                        step: 1,
                        icon: 'mdi:shaker-outline',
                    },
                    extra_rinse: {
                        platform: 'sensor',
                        unique_id: '$deviceid-extra-rinse',
                        state_topic: '$this/extra_rinse',
                        name: 'Extra rinse',
                        unit_of_measurement: 'times',
                        icon: 'mdi:water-plus',
                    },
                    downloaded_course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-downloaded-course',
                        state_topic: '$this/downloaded_course',
                        name: 'Downloaded course',
                        icon: 'mdi:download',
                    },
                    remote_mode: {
                        platform: 'select',
                        unique_id: '$deviceid-remote-mode',
                        state_topic: '$this/remote_mode',
                        command_topic: '$this/remote_mode/set',
                        options: REMOTE_MODE_OPTIONS,
                        name: 'Remote mode',
                        icon: 'mdi:remote',
                    },
                    brightness: {
                        platform: 'select',
                        unique_id: '$deviceid-brightness',
                        state_topic: '$this/brightness',
                        command_topic: '$this/brightness/set',
                        options: BRIGHTNESS_OPTIONS,
                        name: 'Display brightness',
                        icon: 'mdi:brightness-6',
                    },
                    door: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-door',
                        state_topic: '$this/door',
                        name: 'Door',
                        device_class: 'door',
                        payload_on: 'OPEN',
                        payload_off: 'CLOSED',
                    },
                    clean_reminder: {
                        platform: 'switch',
                        unique_id: '$deviceid-clean-reminder',
                        state_topic: '$this/clean_reminder',
                        command_topic: '$this/clean_reminder/set',
                        name: 'Clean reminder',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:lightbulb-on-outline',
                    },
                    auto_dry: {
                        platform: 'switch',
                        unique_id: '$deviceid-auto-dry',
                        state_topic: '$this/auto_dry',
                        command_topic: '$this/auto_dry/set',
                        name: 'Auto dry',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:weather-windy',
                    },
                    extra_dry: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-extra-dry',
                        state_topic: '$this/extra_dry',
                        name: 'Extra dry',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:heat-wave',
                    },
                    high_temp: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-high-temp',
                        state_topic: '$this/high_temp',
                        name: 'High temperature',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:thermometer-high',
                    },
                    steam: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-steam',
                        state_topic: '$this/steam',
                        name: 'Steam',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:weather-fog',
                    },
                    remote_start_active: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-remote-start-active',
                        state_topic: '$this/remote_start_active',
                        name: 'Remote start active',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:remote',
                    },
                    end_alarm: {
                        platform: 'switch',
                        unique_id: '$deviceid-end-alarm',
                        state_topic: '$this/end_alarm',
                        command_topic: '$this/end_alarm/set',
                        name: 'End alarm',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        icon: 'mdi:bell-ring-outline',
                    },
                    buzzer: {
                        platform: 'select',
                        unique_id: '$deviceid-buzzer',
                        state_topic: '$this/buzzer',
                        command_topic: '$this/buzzer/set',
                        options: BUZZER_OPTIONS,
                        name: 'Buzzer',
                        icon: 'mdi:volume-high',
                    },
                    power: {
                        platform: 'switch',
                        unique_id: '$deviceid-power',
                        state_topic: '$this/power',
                        command_topic: '$this/power/set',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        name: 'Power',
                        icon: 'mdi:power',
                    },
                    pause: {
                        platform: 'button',
                        unique_id: '$deviceid-pause',
                        command_topic: '$this/pause/set',
                        payload_press: '',
                        name: 'Pause',
                        icon: 'mdi:pause-circle-outline',
                    },
                    resume: {
                        platform: 'button',
                        unique_id: '$deviceid-resume',
                        command_topic: '$this/resume/set',
                        payload_press: '',
                        name: 'Resume',
                        icon: 'mdi:play-circle-outline',
                    },
                    cancel: {
                        platform: 'button',
                        unique_id: '$deviceid-cancel',
                        command_topic: '$this/cancel/set',
                        payload_press: '',
                        name: 'Cancel cycle',
                        icon: 'mdi:stop-circle-outline',
                    },
                    remote_course: {
                        platform: 'select',
                        unique_id: '$deviceid-remote-course',
                        state_topic: '$this/remote_course',
                        command_topic: '$this/remote_course/set',
                        options: Object.keys(REMOTE_COURSES),
                        optimistic: true,
                        name: 'Remote course',
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
                        name: 'Remote delay',
                        icon: 'mdi:timer-outline',
                    },
                    remote_high_temp: {
                        platform: 'switch',
                        unique_id: '$deviceid-remote-high-temp',
                        state_topic: '$this/remote_high_temp',
                        command_topic: '$this/remote_high_temp/set',
                        optimistic: true,
                        name: 'Remote high temperature',
                        icon: 'mdi:thermometer-high',
                    },
                    remote_steam: {
                        platform: 'switch',
                        unique_id: '$deviceid-remote-steam',
                        state_topic: '$this/remote_steam',
                        command_topic: '$this/remote_steam/set',
                        optimistic: true,
                        name: 'Remote steam',
                        icon: 'mdi:weather-fog',
                    },
                    remote_extra_dry: {
                        platform: 'switch',
                        unique_id: '$deviceid-remote-extra-dry',
                        state_topic: '$this/remote_extra_dry',
                        command_topic: '$this/remote_extra_dry/set',
                        optimistic: true,
                        name: 'Remote extra dry',
                        icon: 'mdi:heat-wave',
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
                        name: 'Remote extra rinse',
                        icon: 'mdi:water-plus',
                    },
                    remote_start: {
                        platform: 'button',
                        unique_id: '$deviceid-remote-start',
                        command_topic: '$this/remote_start/set',
                        payload_press: '',
                        name: 'Remote start',
                        icon: 'mdi:play-circle-outline',
                    },
                    energy_delta: {
                        platform: 'sensor',
                        unique_id: '$deviceid-energy-delta',
                        state_topic: '$this/energy_delta',
                        name: 'Recent energy',
                        device_class: 'energy',
                        state_class: 'measurement',
                        unit_of_measurement: 'Wh',
                    },
                    energy_total: {
                        platform: 'sensor',
                        unique_id: '$deviceid-energy-total',
                        state_topic: '$this/energy_total',
                        name: 'Cycle energy',
                        device_class: 'energy',
                        state_class: 'measurement',
                        unit_of_measurement: 'Wh',
                    },
                    diagnostic_stage: {
                        platform: 'sensor',
                        unique_id: '$deviceid-diagnostic-stage',
                        state_topic: '$this/diagnostic_stage',
                        name: 'Diagnostic stage',
                        entity_category: 'diagnostic',
                        icon: 'mdi:progress-wrench',
                    },
                    protocol_status: {
                        platform: 'sensor',
                        unique_id: '$deviceid-protocol-status',
                        state_topic: '$this/protocol_status',
                        name: 'Protocol status',
                        icon: 'mdi:code-json',
                        entity_category: 'diagnostic',
                    },
                },
            }),
        )
    }

    start() {
        this.publishProperty('remote_course', 'AUTO')
        this.publishProperty('remote_delay', 0)
        this.publishProperty('remote_steam', 'OFF')
        this.publishProperty('remote_high_temp', 'OFF')
        this.publishProperty('remote_extra_dry', 'OFF')
        this.publishProperty('remote_extra_rinse', 0)
        this.send(Buffer.from('F0ED1211010000010400', 'hex'))
    }

    processAABB(buf: Buffer) {
        if (buf[0] !== 0x32) return

        if (buf[1] === 0xeb && buf.length === 2 + STATUS_BLOCK_LENGTH) {
            this.publishStatus(buf.subarray(2))
        } else if (buf[1] === 0xec && buf.length === 2 + STATUS_BLOCK_LENGTH * 2) {
            this.publishStatus(buf.subarray(2 + STATUS_BLOCK_LENGTH))
        } else if (buf[1] === 0x3e && buf.length === 7) {
            this.publishProperty('energy_delta', buf.readUInt16BE(2))
            this.publishProperty('energy_total', buf.readUInt16BE(4))
        } else if (buf[1] === 0xcf && buf.length === 115) {
            this.publishProperty('diagnostic_stage', formatEnum(DIAGNOSTIC_STAGES, buf[8]))
        }
    }

    private publishStatus(status: Buffer) {
        if (status.length !== STATUS_BLOCK_LENGTH || status[0] !== 0x00 || status[1] !== STATUS_DATA_LENGTH) return

        const data = status.subarray(2)
        const downloadedCourse = data[20]
        const course = downloadedCourse
            ? formatEnum(DOWNLOADED_COURSES, downloadedCourse)
            : formatEnum(COURSES, data[5])
        const state = data[0]
        const remoteMode = this.remoteMode(data[16])
        const buzzer = data[15] & 0x80 ? 'HIGH' : data[15] & 0x40 ? 'LOW' : 'OFF'

        this.settings.rinse = data[13]
        this.settings.salt = data[14]
        this.settings.opt1 =
            (data[16] & 0x04 ? 0x40 : 0) |
            (data[11] & 0x10 ? 0x20 : 0) |
            (data[11] & 0x40 ? 0x08 : 0) |
            (buzzer === 'HIGH' ? 0x04 : buzzer === 'LOW' ? 0x02 : 0)
        this.settings.opt2 = remoteMode === 'ALWAYS' ? 0x80 : remoteMode === 'ONE_TIME' ? 0x40 : 0xc0
        this.settings.opt3 = data[19] & 0x40
        this.hasStatus = true

        this.publishProperty('protocol_status', status.toString('hex').toUpperCase())
        this.publishProperty('state', formatEnum(STATES, state))
        this.publishProperty('power', state === 0x01 || state === 0x02 || state === 0x03 ? 'ON' : 'OFF')
        this.publishProperty('course', course)
        this.publishProperty('initial_time', data[3] * 60 + data[4])
        this.publishProperty('remaining_time', data[7] * 60 + data[8])
        this.publishProperty('delay_start', data[9])
        this.publishProperty('door', data[11] & 0x02 ? 'OPEN' : 'CLOSED')
        this.publishProperty('clean_reminder', data[11] & 0x40 ? 'ON' : 'OFF')
        this.publishProperty('auto_dry', data[11] & 0x10 ? 'ON' : 'OFF')
        this.publishProperty('extra_dry', data[12] & 0x04 ? 'ON' : 'OFF')
        this.publishProperty('high_temp', data[12] & 0x08 ? 'ON' : 'OFF')
        this.publishProperty('steam', data[12] & 0x80 ? 'ON' : 'OFF')
        this.publishProperty('rinse_level', data[13])
        this.publishProperty('salt_level', data[14])
        this.publishProperty('remote_start_active', data[15] & 0x02 ? 'ON' : 'OFF')
        this.publishProperty('remote_mode', remoteMode)
        this.publishProperty('end_alarm', data[16] & 0x04 ? 'ON' : 'OFF')
        this.publishProperty('brightness', data[19] & 0x40 ? 'HIGH' : 'NORMAL')
        this.publishProperty('buzzer', buzzer)
        this.publishProperty(
            'downloaded_course',
            downloadedCourse ? formatEnum(DOWNLOADED_COURSES, downloadedCourse) : 'NONE',
        )
        this.publishProperty('extra_rinse', (data[21] & 0x30) >> 4)
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

    setProperty(prop: string, value: string) {
        if (prop === 'power') {
            this.send(Buffer.from(value === 'ON' ? 'F02616' : 'F02612', 'hex'))
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
        } else if (prop === 'auto_dry') {
            this.updateSettingBit('opt1', 0x20, value === 'ON')
        } else if (prop === 'end_alarm') {
            this.updateSettingBit('opt1', 0x40, value === 'ON')
        } else if (prop === 'buzzer' && BUZZER_OPTIONS.includes(value)) {
            this.settings.opt1 = (this.settings.opt1 & ~0x06) | (value === 'HIGH' ? 0x04 : value === 'LOW' ? 0x02 : 0)
            this.sendSettings()
        } else if (prop === 'remote_mode' && REMOTE_MODE_OPTIONS.includes(value)) {
            this.settings.opt2 = value === 'ALWAYS' ? 0x80 : value === 'ONE_TIME' ? 0x40 : 0xc0
            this.sendSettings()
        } else if (prop === 'brightness' && BRIGHTNESS_OPTIONS.includes(value)) {
            this.updateSettingBit('opt3', 0x40, value === 'HIGH')
        } else if (prop === 'remote_course' && value in REMOTE_COURSES) {
            this.remoteStart.course = REMOTE_COURSES[value]
            this.publishProperty(prop, value)
        } else if (prop === 'remote_delay') {
            this.remoteStart.delay = this.clampedInteger(value, 0, 12)
            this.publishProperty(prop, this.remoteStart.delay)
        } else if (prop === 'remote_high_temp') {
            this.remoteStart.highTemp = value === 'ON'
            this.publishProperty(prop, this.remoteStart.highTemp ? 'ON' : 'OFF')
        } else if (prop === 'remote_steam') {
            this.remoteStart.steam = value === 'ON'
            this.publishProperty(prop, this.remoteStart.steam ? 'ON' : 'OFF')
        } else if (prop === 'remote_extra_dry') {
            this.remoteStart.extraDry = value === 'ON'
            this.publishProperty(prop, this.remoteStart.extraDry ? 'ON' : 'OFF')
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
                0x00,
            ]),
        )
    }

    private sendRemoteStart() {
        const options =
            (this.remoteStart.steam ? 0x80 : 0) |
            (this.remoteStart.highTemp ? 0x08 : 0) |
            (this.remoteStart.extraDry ? 0x04 : 0)
        const rinse =
            (this.remoteStart.extraRinse * 0x08) |
            (this.remoteStart.course === REMOTE_COURSES.DOWNLOAD_CYCLE ? 0x40 : 0)

        this.send(
            Buffer.from([
                0xf0,
                0x26,
                0x10,
                this.remoteStart.course,
                this.remoteStart.delay,
                0x00,
                options,
                rinse,
                0x00,
            ]),
        )
    }

    private clampedInteger(value: string, min: number, max: number) {
        const parsed = Number.parseInt(value, 10)
        if (!Number.isFinite(parsed)) return min
        return Math.max(min, Math.min(max, parsed))
    }
}

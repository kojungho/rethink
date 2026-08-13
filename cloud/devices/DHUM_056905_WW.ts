import HADevice from './base'
import TLVDevice from './tlv_device'
import { Device as Thinq2Device } from '../thinq2/device'
import { DeviceDiscovery, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import * as TLV from '@/util/tlv'
import crc16 from '@/util/crc16'

const fields = {
    power: 0x1f7,
    mode: 0x1f9,
    fanSpeed: 0x1fa,
    offTimer: 0x21b,
    lighting: 0x21e,
    displayLight: 0x21f,
    targetHumidity: 0x253,
    uVnano: 0x2a2,
    buttonSound: 0x3a0,
    humiditySensorMode: 0x337,
} as const

const humiditySensorCommand = 0x50c

const modes: Record<number, string> = {
    0x11: '스마트 제습',
    0x12: '쾌속 제습',
    0x13: '저소음 제습',
    0x14: '집중 건조',
    0x15: '의류 건조',
}

const modeValues = Object.fromEntries(Object.entries(modes).map(([key, value]) => [value, Number(key)]))

const fanSpeeds: Record<number, string> = {
    2: '약풍',
    6: '강풍',
}

const fanSpeedValues = Object.fromEntries(Object.entries(fanSpeeds).map(([key, value]) => [value, Number(key)]))

export default class Device extends TLVDevice {
    readonly deviceConfig: DeviceDiscovery

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.deviceConfig = HADevice.config(meta, { name: 'LG Dehumidifier' })
        this.setConfig(
            allowExtendedType({
                ...this.deviceConfig,
                components: {
                    humidifier: {
                        platform: 'humidifier',
                        device_class: 'dehumidifier',
                        unique_id: '$deviceid-humidifier',
                        name: null,
                        state_topic: '$this/power',
                        command_topic: '$this/power/set',
                        action_topic: '$this/humidifier_action',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        modes: Object.values(modes),
                        mode_state_topic: '$this/operating_mode',
                        mode_command_topic: '$this/operating_mode/set',
                        current_humidity_topic: '$this/current_humidity',
                        target_humidity_state_topic: '$this/target_humidity',
                        target_humidity_command_topic: '$this/target_humidity/set',
                        min_humidity: 30,
                        max_humidity: 70,
                    },
                    power: {
                        platform: 'switch',
                        unique_id: '$deviceid-power',
                        name: '전원',
                        state_topic: '$this/power',
                        command_topic: '$this/power/set',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                    },
                    operating_mode: {
                        platform: 'select',
                        unique_id: '$deviceid-operating_mode',
                        name: '운전 모드',
                        entity_category: 'config',
                        state_topic: '$this/operating_mode',
                        command_topic: '$this/operating_mode/set',
                        options: Object.values(modes),
                    },
                    fan_speed: {
                        platform: 'select',
                        unique_id: '$deviceid-fan_speed',
                        name: '팬 속도',
                        state_topic: '$this/fan_speed',
                        command_topic: '$this/fan_speed/set',
                        options: Object.values(fanSpeeds),
                    },
                    target_humidity: {
                        platform: 'number',
                        device_class: 'humidity',
                        unique_id: '$deviceid-target_humidity',
                        name: '목표 습도',
                        state_topic: '$this/target_humidity',
                        command_topic: '$this/target_humidity/set',
                        unit_of_measurement: '%',
                        min: 30,
                        max: 70,
                        step: 5,
                    },
                    current_humidity: {
                        platform: 'sensor',
                        device_class: 'humidity',
                        state_class: 'measurement',
                        unique_id: '$deviceid-current_humidity',
                        name: '현재 습도',
                        state_topic: '$this/current_humidity',
                        unit_of_measurement: '%',
                    },
                    off_timer: {
                        platform: 'number',
                        unique_id: '$deviceid-off_timer',
                        name: '꺼짐 예약',
                        entity_category: 'config',
                        state_topic: '$this/off_timer',
                        command_topic: '$this/off_timer/set',
                        unit_of_measurement: 'min',
                        min: 0,
                        max: 480,
                        step: 60,
                    },
                    humidity_sensor_mode: {
                        platform: 'select',
                        unique_id: '$deviceid-humidity_sensor_mode',
                        name: '습도 센서 검침',
                        entity_category: 'config',
                        state_topic: '$this/humidity_sensor_mode',
                        command_topic: '$this/humidity_sensor_mode/set',
                        options: ['항상 검침', '운전 중에만 검침'],
                    },
                    child_lock: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-child_lock',
                        name: '차일드락',
                        icon: 'mdi:lock',
                        state_topic: '$this/child_lock',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        entity_category: 'diagnostic',
                    },
                    water_tank_full: {
                        platform: 'binary_sensor',
                        device_class: 'problem',
                        unique_id: '$deviceid-water_tank_full',
                        name: '물통 가득 참',
                        icon: 'mdi:water-alert',
                        state_topic: '$this/water_tank_full',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                        entity_category: 'diagnostic',
                    },
                    uvnano: switchConfig('uvnano', 'UVnano', 'mdi:air-purifier', 'config'),
                    lighting: switchConfig('lighting', '라이팅', 'mdi:lightbulb', 'config'),
                    display_light: switchConfig('display_light', '표시부 조명', 'mdi:brightness-6', 'config'),
                    button_sound: switchConfig('button_sound', '버튼음', 'mdi:volume-high', 'config'),
                },
            }),
        )

        // DHUM status frames use the A8 67 layout rather than the generic TLV
        // response layout. Stop the inherited TLV capability polling; it cannot
        // succeed for this device and only creates needless traffic.
        if (this.query_caps_timeout != undefined) {
            clearInterval(this.query_caps_timeout)
            this.query_caps_timeout = undefined
        }
    }

    start() {
        // The appliance reports status asynchronously; generic TLV polling is
        // not understood by this protocol variant.
    }

    processData(buf: Buffer) {
        // This model reports its current configuration in an A7 02 packet.
        // Its payload is the normal compact TLV sequence, but the transport
        // header differs from the generic TLVDevice response header.
        if (
            buf.length >= 13 &&
            buf[0] === 0x00 &&
            buf[1] === 0x00 &&
            buf[2] === 0x04 &&
            buf[6] === 0xa7 &&
            buf[7] === 0x02 &&
            buf[8] === 0x04 &&
            buf[10] === buf.length - 13
        ) {
            this.processTLV(TLV.parse(buf.subarray(11, buf.length - 2)))
            return
        }
        if (
            buf.length >= 33 &&
            buf[0] === 0x00 &&
            buf[1] === 0x00 &&
            buf[2] === 0x04 &&
            buf[6] === 0xa8 &&
            buf[7] === 0x67
        ) {
            this.processStatus(buf)
            return
        }
        super.processData(buf)
    }

    private processStatus(buf: Buffer) {
        // Confirmed against mode, fan-speed, and target-humidity packet captures.
        // This compact frame's power byte is not a boolean state, so power is
        // only published from the authoritative A7 02 settings packet.
        this.processKeyValue(fields.mode, buf[17])
        this.processKeyValue(fields.targetHumidity, buf[18])
        this.processKeyValue(fields.fanSpeed, buf[19])
        // Offset 56 is the measured room humidity (for example 0x37 = 55%).
        this.HA.publishProperty(this.id, 'current_humidity', buf[56])
        // Captures show byte 36 changes only with the appliance child lock.
        this.HA.publishProperty(this.id, 'child_lock', buf[36] ? 'ON' : 'OFF')
        // The water-tank-full capture reports code 4 here; normal operation is 0.
        this.HA.publishProperty(this.id, 'water_tank_full', buf[59] === 4 ? 'ON' : 'OFF')
    }

    isCapsResponse(tlv: { t: number }[]) {
        return tlv.some(({ t }) => t === fields.power)
    }

    isValuesResponse(tlv: { t: number }[]) {
        return tlv.some(({ t }) => t === fields.power)
    }

    processKeyValue(id: number, value: number) {
        this.raw_clip_state[id] = value
        if (id === fields.power) {
            const on = value !== 0
            this.HA.publishProperty(this.id, 'power', on ? 'ON' : 'OFF')
            this.HA.publishProperty(this.id, 'humidifier_action', on ? 'drying' : 'off')
        }
        if (id === fields.mode && modes[value]) this.HA.publishProperty(this.id, 'operating_mode', modes[value])
        if (id === fields.fanSpeed && fanSpeeds[value]) this.HA.publishProperty(this.id, 'fan_speed', fanSpeeds[value])
        if (id === fields.targetHumidity) this.HA.publishProperty(this.id, 'target_humidity', value)
        if (id === fields.offTimer) this.HA.publishProperty(this.id, 'off_timer', value)
        if (id === fields.humiditySensorMode)
            this.HA.publishProperty(this.id, 'humidity_sensor_mode', value ? '항상 검침' : '운전 중에만 검침')
        if (id === fields.uVnano) this.HA.publishProperty(this.id, 'uvnano', value ? 'ON' : 'OFF')
        if (id === fields.lighting) this.HA.publishProperty(this.id, 'lighting', value ? 'ON' : 'OFF')
        if (id === fields.displayLight) this.HA.publishProperty(this.id, 'display_light', value ? 'OFF' : 'ON')
        if (id === fields.buttonSound) this.HA.publishProperty(this.id, 'button_sound', value ? 'OFF' : 'ON')
    }

    setProperty(prop: string, value: string) {
        const bool = (id: number) => this.write(id, value === 'ON' ? 1 : 0)
        if (prop === 'power') return bool(fields.power)
        if (prop === 'uvnano') return bool(fields.uVnano)
        if (prop === 'lighting') return bool(fields.lighting)
        if (prop === 'display_light') return this.write(fields.displayLight, value === 'ON' ? 0 : 1)
        if (prop === 'button_sound') return this.write(fields.buttonSound, value === 'ON' ? 0 : 1)
        if (prop === 'operating_mode' && modeValues[value] != null) return this.write(fields.mode, modeValues[value])
        if (prop === 'fan_speed' && fanSpeedValues[value] != null) return this.write(fields.fanSpeed, fanSpeedValues[value])
        if (prop === 'target_humidity') return this.write(fields.targetHumidity, Number(value))
        if (prop === 'off_timer') return this.write(fields.offTimer, Number(value))
        if (prop === 'humidity_sensor_mode') return this.writeHumiditySensorMode(value === '항상 검침' ? 1 : 0)
        console.warn(`Attempting to set unsupported dehumidifier property ${prop}`)
    }

    private write(id: number, value: number) {
        if (!Number.isInteger(value) || value < 0) return
        this.raw_clip_state[id] = value
        this.send([1, 1, 2, 1, 1], [{ t: id, v: value }])
    }

    private writeHumiditySensorMode(value: number) {
        // This setting uses the model's FD private command, not the normal TLV
        // setter. Captures confirm 0x50c: 1 = always, 0 = only while operating.
        const message = [
            0x01,
            0x02,
            0x04,
            0x00,
            0x00,
            0x00,
            0x65,
            0xfd,
            0x01,
            0x00,
            humiditySensorCommand >> 8,
            humiditySensorCommand & 0xff,
            0x00,
            0x00,
            0x00,
            value,
        ]
        const checksum = crc16(message.slice(2))
        message.push(checksum >> 8, checksum & 0xff)
        this.thinq.send_packet(Buffer.from(message))
    }
}

function switchConfig(id: string, name: string, icon: string, entityCategory: 'config' | 'diagnostic' | undefined = undefined) {
    return {
        platform: 'switch',
        unique_id: `$deviceid-${id}`,
        name,
        icon,
        state_topic: `$this/${id}`,
        command_topic: `$this/${id}/set`,
        payload_on: 'ON',
        payload_off: 'OFF',
        ...(entityCategory ? { entity_category: entityCategory } : {}),
    }
}

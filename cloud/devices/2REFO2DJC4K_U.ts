import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { DeviceDiscovery, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { freezerRange, fridgeRange } from './fridge_common'
import { commandValueTemplate, displayOptions, displayValueTemplate } from './display_localization'

const DISPLAY_LABELS = {
    OFF: '꺼짐',
    ON: '켜짐',
    AUTO: '자동',
    POWER: '파워',
    REPLACE_FILTER: '필터 교체',
    SMART_CARE_DIAGNOSIS: '스마트케어/진단',
    UNSUPPORTED: '지원 안 함',
    THREE_PIECES: '3개 제빙',
    SIX_PIECES: '6개 제빙',
    NONE: '선택 안 함',
    CRUSHED_ICE: '조각 얼음',
    WATER: '정수',
    CUBED_ICE: '각얼음',
    DISABLED: '사용 안 함',
    UNKNOWN: '알 수 없음',
    SUNSET_TO_SUNRISE: '일몰에서 일출까지',
    SCHEDULED: '시간 설정',
}

const CRAFT_ICE_MODES = ['OFF', 'THREE_PIECES', 'SIX_PIECES']
const DISPENSER_MODES = ['NONE', 'CRUSHED_ICE', 'WATER', 'CUBED_ICE']

export default class Device extends AABBDevice {
    readonly deviceConfig: DeviceDiscovery
    private previousDoorOpen: boolean | undefined
    private doorOpenCount = 0
    private doorOpenedAt: number | undefined

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.deviceConfig = HADevice.config(meta, { name: '냉장고' })
        this.HA.publishConfig(this.id, {
            ...this.deviceConfig,
            components: {
                smart_care: { platform: 'switch' } as unknown as DeviceDiscovery['components'][string],
                night_glare_start_hour: { platform: 'number' } as unknown as DeviceDiscovery['components'][string],
                night_glare_start_minute: { platform: 'number' } as unknown as DeviceDiscovery['components'][string],
                night_glare_end_hour: { platform: 'number' } as unknown as DeviceDiscovery['components'][string],
                night_glare_end_minute: { platform: 'number' } as unknown as DeviceDiscovery['components'][string],
                night_quiet_start_minute: { platform: 'number' } as unknown as DeviceDiscovery['components'][string],
                night_glare_mode: { platform: 'select' } as unknown as DeviceDiscovery['components'][string],
                night_glare_start_time: { platform: 'text' } as unknown as DeviceDiscovery['components'][string],
                night_glare_end_time: { platform: 'text' } as unknown as DeviceDiscovery['components'][string],
                night_glare_brightness: { platform: 'number' } as unknown as DeviceDiscovery['components'][string],
                night_glare_apply: { platform: 'button' } as unknown as DeviceDiscovery['components'][string],
                night_quiet_mode: { platform: 'select' } as unknown as DeviceDiscovery['components'][string],
                night_quiet_start_hour: { platform: 'number' } as unknown as DeviceDiscovery['components'][string],
                night_quiet_duration: { platform: 'number' } as unknown as DeviceDiscovery['components'][string],
                night_quiet_apply: { platform: 'button' } as unknown as DeviceDiscovery['components'][string],
            },
        })
        // Remove the incorrect generic night-setting sensor from an earlier
        // discovery payload.
        this.HA.publishConfig(this.id, {
            ...this.deviceConfig,
            components: {
                night_setting: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
            },
        })
        this.setConfig(
            allowExtendedType({
                ...this.deviceConfig,
                components: {
                    power_status: {
                        platform: 'binary_sensor',
                        device_class: 'power',
                        unique_id: '$deviceid-power_status',
                        state_topic: '$this/power_status',
                        name: '전원 상태',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                    },
                    fridge_setpoint: {
                        platform: 'number',
                        device_class: 'temperature',
                        unique_id: '$deviceid-fridge_setpoint',
                        state_topic: '$this/fridge_setpoint',
                        command_topic: '$this/fridge_setpoint/set',
                        name: '냉장실 온도',
                        ...fridgeRange('C'),
                    },
                    freezer_setpoint: {
                        platform: 'number',
                        device_class: 'temperature',
                        unique_id: '$deviceid-freezer_setpoint',
                        state_topic: '$this/freezer_setpoint',
                        command_topic: '$this/freezer_setpoint/set',
                        name: '냉동실 온도',
                        ...freezerRange('C'),
                    },
                    door: {
                        platform: 'binary_sensor',
                        device_class: 'door',
                        unique_id: '$deviceid-door',
                        state_topic: '$this/door',
                        name: '문 열림',
                    },
                    door_open_count: {
                        platform: 'sensor',
                        icon: 'mdi:door-open',
                        unique_id: '$deviceid-door_open_count',
                        state_topic: '$this/door_open_count',
                        name: '문 열림 횟수',
                        state_class: 'total_increasing',
                        unit_of_measurement: '회',
                    },
                    current_door_open_duration: {
                        platform: 'sensor',
                        device_class: 'duration',
                        icon: 'mdi:timer-sand',
                        unique_id: '$deviceid-current_door_open_duration',
                        state_topic: '$this/current_door_open_duration',
                        name: '현재 문 열림 시간',
                        state_class: 'measurement',
                        unit_of_measurement: 's',
                    },
                    last_door_opened_at: {
                        platform: 'sensor',
                        device_class: 'timestamp',
                        icon: 'mdi:clock-outline',
                        unique_id: '$deviceid-last_door_opened_at',
                        state_topic: '$this/last_door_opened_at',
                        name: '마지막 문 열림 시각',
                    },
                    last_door_open_duration: {
                        platform: 'sensor',
                        device_class: 'duration',
                        icon: 'mdi:timer-check-outline',
                        unique_id: '$deviceid-last_door_open_duration',
                        state_topic: '$this/last_door_open_duration',
                        name: '마지막 문 열림 지속 시간',
                        state_class: 'measurement',
                        unit_of_measurement: 's',
                    },
                    express_freeze: {
                        platform: 'switch',
                        icon: 'mdi:snowflake',
                        unique_id: '$deviceid-express_freeze',
                        state_topic: '$this/express_freeze',
                        command_topic: '$this/express_freeze/set',
                        name: '급속 냉동',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                    },
                    express_cool_status: {
                        platform: 'binary_sensor',
                        icon: 'mdi:snowflake-thermometer',
                        unique_id: '$deviceid-express_cool_status',
                        state_topic: '$this/express_cool_status',
                        name: '급속 냉장 상태',
                        entity_category: 'diagnostic',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                    },
                    pure_n_fresh: {
                        platform: 'sensor',
                        icon: 'mdi:air-filter',
                        unique_id: '$deviceid-pure_n_fresh',
                        state_topic: '$this/pure_n_fresh',
                        name: '퓨어 프레쉬 상태',
                        entity_category: 'diagnostic',
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    display_lock_raw: {
                        platform: 'sensor',
                        icon: 'mdi:lock-question',
                        unique_id: '$deviceid-display_lock_raw',
                        state_topic: '$this/display_lock_raw',
                        name: '표시창 잠금 원시값',
                        entity_category: 'diagnostic',
                    },
                    energy_report_type: {
                        platform: 'sensor',
                        icon: 'mdi:identifier',
                        unique_id: '$deviceid-energy_report_type',
                        state_topic: '$this/energy_report_type',
                        name: '에너지 보고 유형',
                        entity_category: 'diagnostic',
                    },
                    energy_report_raw: {
                        platform: 'sensor',
                        icon: 'mdi:lightning-bolt',
                        unique_id: '$deviceid-energy_report_raw',
                        state_topic: '$this/energy_report_raw',
                        name: '에너지 보고 원시값',
                        entity_category: 'diagnostic',
                    },
                    smart_care: {
                        platform: 'sensor',
                        icon: 'mdi:heart-pulse',
                        unique_id: '$deviceid-smart_care',
                        state_topic: '$this/smart_care',
                        name: '스마트케어+',
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    smart_care_control: {
                        platform: 'switch',
                        icon: 'mdi:heart-pulse',
                        unique_id: '$deviceid-smart_care_control',
                        state_topic: '$this/smart_care_control',
                        command_topic: '$this/smart_care_control/set',
                        name: '스마트케어+ 제어',
                        entity_category: 'config',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                    },
                    night_glare_prevention: {
                        platform: 'sensor',
                        icon: 'mdi:weather-night',
                        unique_id: '$deviceid-night_glare_prevention',
                        state_topic: '$this/night_glare_prevention',
                        name: '야간 눈부심 방지',
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    night_quiet: {
                        platform: 'sensor',
                        icon: 'mdi:volume-off',
                        unique_id: '$deviceid-night_quiet',
                        state_topic: '$this/night_quiet',
                        name: '야간 조용히',
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    craft_ice: {
                        platform: 'select',
                        icon: 'mdi:ice-pop',
                        name: '크래프트 아이스',
                        unique_id: '$deviceid-craft_ice',
                        state_topic: '$this/craft_ice',
                        command_topic: '$this/craft_ice/set',
                        options: displayOptions(CRAFT_ICE_MODES, DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                        command_template: commandValueTemplate(DISPLAY_LABELS),
                        entity_category: 'config',
                    },
                    dispenser_mode: {
                        platform: 'select',
                        icon: 'mdi:water',
                        name: '출수 모드',
                        unique_id: '$deviceid-dispenser_mode',
                        state_topic: '$this/dispenser_mode',
                        command_topic: '$this/dispenser_mode/set',
                        options: displayOptions(DISPENSER_MODES, DISPLAY_LABELS),
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                        command_template: commandValueTemplate(DISPLAY_LABELS),
                        entity_category: 'config',
                    },
                    selected_dispenser_type: {
                        platform: 'sensor',
                        icon: 'mdi:cup-water',
                        name: '현재 선택 출수 종류',
                        unique_id: '$deviceid-selected_dispenser_type',
                        state_topic: '$this/selected_dispenser_type',
                        value_template: displayValueTemplate(DISPLAY_LABELS),
                    },
                    dispense_volume: {
                        platform: 'sensor',
                        device_class: 'volume',
                        state_class: 'measurement',
                        unit_of_measurement: 'mL',
                        icon: 'mdi:cup-water',
                        name: '정량 출수 설정량',
                        unique_id: '$deviceid-dispense_volume',
                        state_topic: '$this/dispense_volume',
                    },
                    button_sound: {
                        platform: 'switch',
                        icon: 'mdi:volume-high',
                        unique_id: '$deviceid-button_sound',
                        state_topic: '$this/button_sound',
                        command_topic: '$this/button_sound/set',
                        name: '버튼음',
                        entity_category: 'config',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                    },
                },
            }),
        )
    }

    start() {
        // 연결 직후 자발적인 상태 보고를 기다리지 않고 전체 상태를 요청합니다.
        this.send(Buffer.from('F0ED1211010000010400', 'hex'))
    }

    processAABB(buf: Buffer) {
        // 68바이트 상태 블록 규격 적용
        if (buf.length === 2 + 68 * 2 && buf[0] == 0x10 && buf[1] == 0xec) {
            // 이 프레임의 두 번째 상태 블록이 명령 처리 후의 확정 상태다.
            // 첫 번째 블록을 사용하면 Smart Care+가 바로 이전 값으로 덮인다.
            this.processStatus(buf.subarray(2 + 68, 2 + 68 + 68))
        }
        if (buf.length === 2 + 68 && buf[0] == 0x10 && buf[1] == 0xeb) {
            this.processStatus(buf.subarray(2, 2 + 68))
        }
        // 10AF의 정확한 단위와 집계 구간은 아직 확인되지 않았으므로
        // 에너지/전력 센서로 환산하지 않고 원시 진단값만 제공합니다.
        if (buf.length >= 5 && buf[0] === 0x10 && buf[1] === 0xaf) {
            this.publishProperty('energy_report_type', `0x${buf[2].toString(16).padStart(2, '0').toUpperCase()}`)
            this.publishProperty('energy_report_raw', buf.readUInt16BE(buf.length - 2))
        }
    }

    processStatus(curStatus: Buffer, publishAdvancedSettings = true) {
        // 1. 온도 맵핑
        const setpointFridge = 8 - curStatus[1]
        const setpointFreezer = -14 - curStatus[2]

        // 2. 도어 & 기능 상태 (로그 분석결과 냉장/냉동 구분 없이 7번 오프셋으로 통합 수신됨)
        const anyDoorOpen = curStatus[7] === 1 // 0=닫힘, 1=열림
        const expressFreezeOn = curStatus[3] === 2 // 1=끔, 2=켬
        const expressCoolOn = curStatus[16] === 1 // 0=끔, 1=켬
        const buttonSoundOn = curStatus[40] === 1 // 0=끔, 1=켬

        // 이 모델에서 쓰기 동작이 확인되지 않은 필드는 읽기 전용으로 노출합니다.
        const pureNFreshModes: Record<number, string> = {
            1: 'OFF',
            2: 'AUTO',
            3: 'POWER',
            4: 'REPLACE_FILTER',
            7: 'SMART_CARE_DIAGNOSIS',
            0xff: 'UNSUPPORTED',
        }
        const pureNFresh = pureNFreshModes[curStatus[4]] ?? `RAW_${curStatus[4]}`

        // 3. 크래프트 아이스 모드 (0=끔, 1=3 ICE, 2=6 ICE)
        const craftIceMode = CRAFT_ICE_MODES[curStatus[25]] || 'OFF'

        // 4. 정수기 출수 모드 (0=선택안함/마지막, 1=조각얼음, 2=정수, 3=각얼음) - 66번 오프셋 교정완료
        const dispenserMode = DISPENSER_MODES[curStatus[66]] || 'NONE'

        // 정량 출수 설정은 10 mL 단위다. 수동 출수 중에는 이 필드가
        // 실시간으로 변하지 않으므로 누적/실시간 출수량으로 취급하지 않는다.
        const dispenseVolumeUnits = curStatus[65]
        const confirmedDispenseVolumes: Record<number, number> = {
            25: 250,
            50: 500,
            100: 1000,
        }

        // MQTT 퍼블리시
        this.publishProperty('door', anyDoorOpen ? 'ON' : 'OFF')
        this.publishDoorStatistics(anyDoorOpen)
        this.publishProperty('power_status', 'ON')
        this.publishProperty('fridge_setpoint', setpointFridge)
        this.publishProperty('freezer_setpoint', setpointFreezer)
        this.publishProperty('express_freeze', expressFreezeOn ? 'ON' : 'OFF')
        // 0xFF is unsupported/unavailable, not OFF.
        if (curStatus[16] !== 0xff) this.publishProperty('express_cool_status', expressCoolOn ? 'ON' : 'OFF')
        this.publishProperty('pure_n_fresh', pureNFresh)
        this.publishProperty('display_lock_raw', curStatus[10])
        if (publishAdvancedSettings) this.publishAdvancedSettings(curStatus)
        this.publishProperty('craft_ice', craftIceMode)
        this.publishProperty('dispenser_mode', dispenserMode)
        this.publishProperty('selected_dispenser_type', dispenserMode)
        if (dispenseVolumeUnits in confirmedDispenseVolumes) {
            this.publishProperty('dispense_volume', confirmedDispenseVolumes[dispenseVolumeUnits])
        }
        this.publishProperty('button_sound', buttonSoundOn ? 'ON' : 'OFF')
    }

    private publishDoorStatistics(anyDoorOpen: boolean) {
        const now = Date.now()

        if (anyDoorOpen && this.previousDoorOpen !== true) {
            // The first frame may arrive while a door is already open. Record its
            // start time, but only count a confirmed closed -> open transition.
            if (this.previousDoorOpen === false) this.doorOpenCount += 1
            this.doorOpenedAt = now
            this.publishProperty('last_door_opened_at', new Date(now).toISOString())
        }

        if (!anyDoorOpen && this.previousDoorOpen === true && this.doorOpenedAt !== undefined) {
            this.publishProperty('last_door_open_duration', Math.max(0, Math.floor((now - this.doorOpenedAt) / 1000)))
            this.doorOpenedAt = undefined
        }

        const currentDuration =
            anyDoorOpen && this.doorOpenedAt !== undefined
                ? Math.max(0, Math.floor((now - this.doorOpenedAt) / 1000))
                : 0
        this.publishProperty('door_open_count', this.doorOpenCount)
        this.publishProperty('current_door_open_duration', currentDuration)
        this.previousDoorOpen = anyDoorOpen
    }

    private publishAdvancedSettings(status: Buffer) {
        const glareModes = ['DISABLED', 'UNKNOWN', 'SUNSET_TO_SUNRISE', 'SCHEDULED']
        const glareMode = glareModes[status[30]] || 'UNKNOWN'
        const quietMode = status[31] === 3 ? 'SCHEDULED' : 'DISABLED'
        this.publishProperty('smart_care', status[17] === 1 ? 'ON' : 'OFF')
        this.publishProperty('smart_care_control', status[17] === 1 ? 'ON' : 'OFF')
        this.publishProperty('night_glare_prevention', glareMode)
        this.publishProperty('night_quiet', quietMode)
    }

    setProperty(prop: string, mqttValue: string) {
        // 모든 변동이 반영될 수 있는 118바이트 기본 F017 명령어 템플릿
        const baseMessage = Buffer.from(
            'F017FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000000FFFF00FFFFFFFF00FFFFFFFFFFFFFFFFFF00FFFFFF1EFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0AFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
            'hex',
        )

        if (prop === 'fridge_setpoint') {
            baseMessage[2 + 1] = 8 - Number(mqttValue)
            baseMessage[2 + 8] = 1 // 온도 제어시 활성화 플래그
            this.send(baseMessage)
        } else if (prop === 'freezer_setpoint') {
            baseMessage[2 + 2] = -14 - Number(mqttValue)
            baseMessage[2 + 8] = 1
            this.send(baseMessage)
        } else if (prop === 'express_freeze') {
            baseMessage[2 + 3] = mqttValue === 'ON' ? 2 : 1
            this.send(baseMessage)
        } else if (prop === 'smart_care_control') {
            baseMessage[2 + 17] = mqttValue === 'ON' ? 1 : 0
            this.send(baseMessage)
        } else if (prop === 'craft_ice') {
            const map: Record<string, number> = { OFF: 0, THREE_PIECES: 1, SIX_PIECES: 2 }
            baseMessage[2 + 25] = map[mqttValue] ?? 0
            this.send(baseMessage)
        } else if (prop === 'dispenser_mode') {
            const map: Record<string, number> = { NONE: 0, CRUSHED_ICE: 1, WATER: 2, CUBED_ICE: 3 }
            baseMessage[2 + 66] = map[mqttValue] ?? 0 // 이전 코드 65에서 66으로 수정됨
            this.send(baseMessage)
        } else if (prop === 'button_sound') {
            baseMessage[2 + 40] = mqttValue === 'ON' ? 1 : 0
            this.send(baseMessage)
        } else {
            console.warn(`Unknown property ${prop}`)
        }
    }
}

import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { DeviceDiscovery, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { freezerRange, fridgeRange } from './fridge_common'

export default class Device extends AABBDevice {
    readonly deviceConfig: DeviceDiscovery

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.deviceConfig = HADevice.config(meta, { name: 'LG Smart Fridge' })
        // Remove the incorrect generic night-setting sensor from the prior
        // discovery payload before publishing the two separately mapped fields.
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
                    smart_care: {
                        platform: 'switch',
                        icon: 'mdi:heart-pulse',
                        unique_id: '$deviceid-smart_care',
                        state_topic: '$this/smart_care',
                        command_topic: '$this/smart_care/set',
                        name: '스마트케어+',
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
                    },
                    night_quiet: {
                        platform: 'sensor',
                        icon: 'mdi:volume-off',
                        unique_id: '$deviceid-night_quiet',
                        state_topic: '$this/night_quiet',
                        name: '야간 조용히',
                    },
                    craft_ice: {
                        platform: 'select',
                        icon: 'mdi:ice-pop',
                        name: '크래프트 아이스',
                        unique_id: '$deviceid-craft_ice',
                        state_topic: '$this/craft_ice',
                        command_topic: '$this/craft_ice/set',
                        options: ['꺼짐', '3개 제빙', '6개 제빙'],
                        entity_category: 'config',
                    },
                    dispenser_mode: {
                        platform: 'select',
                        icon: 'mdi:water',
                        name: '출수 모드',
                        unique_id: '$deviceid-dispenser_mode',
                        state_topic: '$this/dispenser_mode',
                        command_topic: '$this/dispenser_mode/set',
                        options: ['선택 안 함', '조각 얼음', '정수', '각얼음'],
                        entity_category: 'config',
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
        // 장치가 연결 시 자체 보고하므로 별도의 시작 쿼리는 생략합니다.
    }

    processAABB(buf: Buffer) {
        // 68바이트 상태 블록 규격 적용
        if (buf.length === 2 + 68 * 2 && buf[0] == 0x10 && buf[1] == 0xec) {
            // Preserve the established status block mapping, then use the
            // first (new) block for the advanced-setting change notification.
            this.processStatus(buf.subarray(2 + 68, 2 + 68 + 68), false)
            this.publishAdvancedSettings(buf.subarray(2, 2 + 68))
        }
        if (buf.length === 2 + 68 && buf[0] == 0x10 && buf[1] == 0xeb) {
            this.processStatus(buf.subarray(2, 2 + 68))
        }
    }

    processStatus(curStatus: Buffer, publishAdvancedSettings = true) {
        // 1. 온도 맵핑
        const setpointFridge = 8 - curStatus[1]
        const setpointFreezer = -14 - curStatus[2]
        
        // 2. 도어 & 기능 상태 (로그 분석결과 냉장/냉동 구분 없이 7번 오프셋으로 통합 수신됨)
        const anyDoorOpen = curStatus[7] === 1 // 0=닫힘, 1=열림
        const expressFreezeOn = curStatus[3] === 2 // 1=끔, 2=켬
        const buttonSoundOn = curStatus[40] === 1 // 0=끔, 1=켬

        // 3. 크래프트 아이스 모드 (0=끔, 1=3 ICE, 2=6 ICE)
        const craftIceModes = ['꺼짐', '3개 제빙', '6개 제빙']
        const craftIceMode = craftIceModes[curStatus[25]] || '꺼짐'

        // 4. 정수기 출수 모드 (0=선택안함/마지막, 1=조각얼음, 2=정수, 3=각얼음) - 66번 오프셋 교정완료
        const dispenserModes = ['선택 안 함', '조각 얼음', '정수', '각얼음']
        const dispenserMode = dispenserModes[curStatus[66]] || '선택 안 함'

        // MQTT 퍼블리시
        this.publishProperty('door', anyDoorOpen ? 'ON' : 'OFF')
        this.publishProperty('power_status', 'ON')
        this.publishProperty('fridge_setpoint', setpointFridge)
        this.publishProperty('freezer_setpoint', setpointFreezer)
        this.publishProperty('express_freeze', expressFreezeOn ? 'ON' : 'OFF')
        if (publishAdvancedSettings) this.publishAdvancedSettings(curStatus)
        this.publishProperty('craft_ice', craftIceMode)
        this.publishProperty('dispenser_mode', dispenserMode)
        this.publishProperty('button_sound', buttonSoundOn ? 'ON' : 'OFF')
    }

    private publishAdvancedSettings(status: Buffer) {
        const glareModes = ['사용 안 함', '알 수 없음', '일몰에서 일출까지', '시간 설정']
        this.publishProperty('smart_care', status[17] === 1 ? 'ON' : 'OFF')
        this.publishProperty('night_glare_prevention', glareModes[status[30]] || '알 수 없음')
        this.publishProperty('night_quiet', status[31] === 3 ? '시간 설정' : '사용 안 함')
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
        } else if (prop === 'smart_care') {
            baseMessage[2 + 17] = mqttValue === 'ON' ? 1 : 0
            this.send(baseMessage)
            if (mqttValue === 'OFF') {
                // The refrigerator app sends this confirmed follow-up after
                // Smart Care+ is turned off; without it the first F017 write
                // is acknowledged but the feature remains enabled.
                const finalizeMessage = Buffer.from(baseMessage)
                finalizeMessage[2 + 4] = 6
                setTimeout(() => this.send(finalizeMessage), 250)
            }
        } else if (prop === 'craft_ice') {
            const map: Record<string, number> = { '꺼짐': 0, '3개 제빙': 1, '6개 제빙': 2 }
            baseMessage[2 + 25] = map[mqttValue] ?? 0
            this.send(baseMessage)
        } else if (prop === 'dispenser_mode') {
            const map: Record<string, number> = { '선택 안 함': 0, '조각 얼음': 1, 정수: 2, 각얼음: 3 }
            baseMessage[2 + 66] = map[mqttValue] ?? 0  // 이전 코드 65에서 66으로 수정됨
            this.send(baseMessage)
        } else if (prop === 'button_sound') {
            baseMessage[2 + 40] = mqttValue === 'ON' ? 1 : 0
            this.send(baseMessage)
        } else {
            console.warn(`Unknown property ${prop}`)
        }
    }
}

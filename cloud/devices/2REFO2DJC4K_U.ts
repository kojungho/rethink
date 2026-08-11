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
        this.setConfig(
            allowExtendedType({
                ...this.deviceConfig,
                components: {
                    fridge_setpoint: {
                        platform: 'number',
                        device_class: 'temperature',
                        unique_id: '$deviceid-fridge_setpoint',
                        state_topic: '$this/fridge_setpoint',
                        command_topic: '$this/fridge_setpoint/set',
                        name: 'Fridge temperature',
                        ...fridgeRange('C'),
                    },
                    freezer_setpoint: {
                        platform: 'number',
                        device_class: 'temperature',
                        unique_id: '$deviceid-freezer_setpoint',
                        state_topic: '$this/freezer_setpoint',
                        command_topic: '$this/freezer_setpoint/set',
                        name: 'Freezer temperature',
                        ...freezerRange('C'),
                    },
                    door: {
                        platform: 'binary_sensor',
                        device_class: 'door',
                        unique_id: '$deviceid-door',
                        state_topic: '$this/door',
                        name: 'Door',
                    },
                    express_freeze: {
                        platform: 'switch',
                        icon: 'mdi:snowflake',
                        unique_id: '$deviceid-express_freeze',
                        state_topic: '$this/express_freeze',
                        command_topic: '$this/express_freeze/set',
                        name: 'Express Freeze',
                        payload_on: 'ON',
                        payload_off: 'OFF',
                    },
                    craft_ice: {
                        platform: 'select',
                        icon: 'mdi:ice-pop',
                        name: 'Craft Ice Mode',
                        unique_id: '$deviceid-craft_ice',
                        state_topic: '$this/craft_ice',
                        command_topic: '$this/craft_ice/set',
                        options: ['OFF', '3_ICE', '6_ICE'],
                    },
                    dispenser_mode: {
                        platform: 'select',
                        icon: 'mdi:water',
                        name: 'Dispenser Mode',
                        unique_id: '$deviceid-dispenser_mode',
                        state_topic: '$this/dispenser_mode',
                        command_topic: '$this/dispenser_mode/set',
                        options: ['NONE', 'CRUSHED', 'WATER', 'CUBED'],
                    },
                    button_sound: {
                        platform: 'switch',
                        icon: 'mdi:volume-high',
                        unique_id: '$deviceid-button_sound',
                        state_topic: '$this/button_sound',
                        command_topic: '$this/button_sound/set',
                        name: 'Button Sound',
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
            this.processStatus(buf.subarray(2 + 68, 2 + 68 + 68))
        }
        if (buf.length === 2 + 68 && buf[0] == 0x10 && buf[1] == 0xeb) {
            this.processStatus(buf.subarray(2, 2 + 68))
        }
    }

    processStatus(curStatus: Buffer) {
        // 1. 온도 맵핑
        const setpointFridge = 8 - curStatus[1]
        const setpointFreezer = -14 - curStatus[2]
        
        // 2. 도어 & 기능 상태 (로그 분석결과 냉장/냉동 구분 없이 7번 오프셋으로 통합 수신됨)
        const anyDoorOpen = curStatus[7] === 1 // 0=닫힘, 1=열림
        const expressFreezeOn = curStatus[3] === 2 // 1=끔, 2=켬
        const buttonSoundOn = curStatus[40] === 1 // 0=끔, 1=켬

        // 3. 크래프트 아이스 모드 (0=끔, 1=3 ICE, 2=6 ICE)
        const craftIceModes = ['OFF', '3_ICE', '6_ICE']
        const craftIceMode = craftIceModes[curStatus[25]] || 'OFF'

        // 4. 정수기 출수 모드 (0=선택안함/마지막, 1=조각얼음, 2=정수, 3=각얼음) - 66번 오프셋 교정완료
        const dispenserModes = ['NONE', 'CRUSHED', 'WATER', 'CUBED']
        const dispenserMode = dispenserModes[curStatus[66]] || 'NONE'

        // MQTT 퍼블리시
        this.publishProperty('door', anyDoorOpen ? 'ON' : 'OFF')
        this.publishProperty('fridge_setpoint', setpointFridge)
        this.publishProperty('freezer_setpoint', setpointFreezer)
        this.publishProperty('express_freeze', expressFreezeOn ? 'ON' : 'OFF')
        this.publishProperty('craft_ice', craftIceMode)
        this.publishProperty('dispenser_mode', dispenserMode)
        this.publishProperty('button_sound', buttonSoundOn ? 'ON' : 'OFF')
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
        } else if (prop === 'craft_ice') {
            const map: Record<string, number> = { OFF: 0, '3_ICE': 1, '6_ICE': 2 }
            baseMessage[2 + 25] = map[mqttValue] ?? 0
            this.send(baseMessage)
        } else if (prop === 'dispenser_mode') {
            const map: Record<string, number> = { NONE: 0, CRUSHED: 1, WATER: 2, CUBED: 3 }
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

import RACDevice, { AC_DISPLAY_LABELS } from './RAC_056905_WW'
import { Device as Thinq2Device } from '../thinq2/device'
import { DeviceDiscovery, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import * as TLV from '@/util/tlv'
import HADevice from './base'
import { displayOptions } from './display_localization'

const fields = {
    power: 0x1f7,
    mode: 0x1f9,
    fanSpeed: 0x1fa,
    currentTemperature: 0x1fd,
    targetTemperature: 0x1fe,
    standbyTimeFormat: 0x1a2,
    standbyDate: 0x1a4,
    standbyIndoorAir: 0x1a6,
    standbyOutdoorAir: 0x1a7,
    standbyClock: 0x1b0,
    standbyInterval: 0x1b3,
    standbyPower: 0x1b5,
    standbyAutoSwitch: 0x1b9,
} as const

const standbyTypeFields = [fields.standbyIndoorAir, fields.standbyOutdoorAir, fields.standbyClock] as const
const standbyFields = [
    fields.standbyIndoorAir,
    fields.standbyTimeFormat,
    fields.standbyPower,
    fields.standbyDate,
    fields.standbyInterval,
    fields.standbyOutdoorAir,
    fields.standbyAutoSwitch,
    fields.standbyClock,
] as const

/** LG Korean stand air conditioner using A7 TLV notifications and A8 fixed status frames. */
export default class Device extends RACDevice {
    private fanModeProfile: 'dry' | 'levels' = 'levels'
    private standbyTimeSyncTimeout: ReturnType<typeof setTimeout> | undefined

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq, meta)
        if (this.query_caps_timeout != undefined) {
            clearInterval(this.query_caps_timeout)
            this.query_caps_timeout = undefined
        }
        this.raw_clip_state[0x2cc] = 0x07
        this.raw_clip_state[0x2cd] = 0x0d
        this.raw_clip_state[0x2d3] = 0x01
        this.raw_clip_state[fields.power] = 0
        this.raw_clip_state[fields.mode] = 0
        this.raw_clip_state[fields.fanSpeed] = 4
        this.raw_clip_state[fields.targetTemperature] = 50
        this.raw_clip_state[0x20e] = 0
        this.raw_clip_state[0x1f2] = 2
        this.raw_clip_state[0x2b3] = 60
        // Error code is reported by PAC. The other inherited RAC diagnostic
        // fields are not reported by this model and must not create permanent
        // unknown entities.
        this.raw_clip_state[0x221] = 0
        this.initialValuesReceived = true
        // Remove the legacy RAC switch discovery before replacing the same
        // component keys with PAC brightness selects.
        this.HA.publishConfig(this.id, {
            ...HADevice.config(meta, { name: '에어컨' }),
            components: {
                display_light: { platform: 'switch' } as unknown as DeviceDiscovery['components'][string],
                button_sound: { platform: 'switch' } as unknown as DeviceDiscovery['components'][string],
                ai_dry_power: { platform: 'switch' } as unknown as DeviceDiscovery['components'][string],
                airflow_direction: { platform: 'select' } as unknown as DeviceDiscovery['components'][string],
                capacity: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
                eev: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
                fanrpm: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
                oduairtemp: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
                oduhextemp: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
                pipeintemp: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
                pipeouttemp: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
                filter_life: { platform: 'sensor' } as unknown as DeviceDiscovery['components'][string],
            },
        })
        this.initMakeSetConfig()
    }

    start() {}
    query() {}

    drop() {
        this.cancelStandbyTimeSync()
        super.drop()
    }

    protected extendConfig(config: DeviceDiscovery) {
        // PAC reports and accepts these controls directly. RAC's deferred
        // power/mode hooks replay cached air-clean/energy/jet values before
        // the PAC status packet has been fully processed, which can turn a
        // newly started fan-only session straight back off.
        this.powerChangeHooks = []
        this.modeChangeHooks = []

        // PAC exposes a five-way airflow direction selector instead of the
        // RAC vertical/horizontal swing controls.
        const climate = config.components.climate as unknown as Record<string, unknown>
        for (const key of [
            'swing_horizontal_modes',
            'swing_horizontal_mode_state_topic',
            'swing_horizontal_mode_command_topic',
        ])
            delete climate[key]
        climate.swing_modes = ['AIRFLOW_FOCUS', 'AIRFLOW_SPLIT', 'AIRFLOW_WIDE', 'AIRFLOW_LEFT', 'AIRFLOW_RIGHT']
        climate.fan_modes = ['FAN_1', 'FAN_2', 'FAN_3', 'FAN_4', 'FAN_5']
        this.addField(config, {
            id: 0x2a3,
            name: 'swing_mode',
            comp: 'climate',
            read_xform: (raw) =>
                (({
                    1: 'AIRFLOW_FOCUS',
                    2: 'AIRFLOW_WIDE',
                    3: 'AIRFLOW_LEFT',
                    4: 'AIRFLOW_RIGHT',
                    5: 'AIRFLOW_SPLIT',
                }) as Record<number, string>)[raw],
            write_xform: (val) =>
                (({
                    AIRFLOW_FOCUS: 1,
                    AIRFLOW_SPLIT: 5,
                    AIRFLOW_WIDE: 2,
                    AIRFLOW_LEFT: 3,
                    AIRFLOW_RIGHT: 4,
                }) as Record<string, number>)[val],
        })

        const sensors = {
            humidity: {
                name: '현재 습도',
                device_class: 'humidity',
                unit_of_measurement: '%',
                icon: 'mdi:water-percent',
            },
            pm1: { name: 'PM1.0', unit_of_measurement: 'μg/m³', icon: 'mdi:molecule' },
            pm2_5: { name: 'PM2.5', device_class: 'pm25', unit_of_measurement: 'μg/m³', icon: 'mdi:molecule' },
            pm10: { name: 'PM10', device_class: 'pm10', unit_of_measurement: 'μg/m³', icon: 'mdi:molecule' },
            air_quality: { name: '종합 공기질', icon: 'mdi:air-filter' },
            filter_remaining: { name: '필터 잔여량', unit_of_measurement: '%', icon: 'mdi:air-filter' },
        } as const
        for (const [id, sensor] of Object.entries(sensors)) {
            config.components[id] = {
                platform: 'sensor',
                unique_id: `$deviceid-${id}`,
                state_topic: `$this/${id}`,
                state_class: id === 'air_quality' ? undefined : 'measurement',
                entity_category: id === 'filter_remaining' ? 'diagnostic' : undefined,
                ...sensor,
            } as unknown as DeviceDiscovery['components'][string]
        }

        // ThinQ reports this field as remaining minutes on PAC, whereas the
        // inherited RAC profile historically labelled the same tag as a
        // percentage.
        config.components.autodryremain = {
            platform: 'sensor',
            unique_id: '$deviceid-autodryremain',
            state_topic: '$this/autodryremain-',
            name: 'AI 건조 남은 시간',
            icon: 'mdi:timer-sand',
            device_class: 'duration',
            unit_of_measurement: 'min',
            state_class: 'measurement',
            entity_category: 'diagnostic',
        } as unknown as DeviceDiscovery['components'][string]

        config.components.temperature_step = {
            platform: 'select',
            unique_id: '$deviceid-temperature-step',
            name: '온도 조절 단위',
            icon: 'mdi:thermometer-lines',
            options: ['HALF_DEGREE', 'ONE_DEGREE'],
            entity_category: 'config',
        } as unknown as DeviceDiscovery['components'][string]
        this.addField(config, {
            id: 0x1fb,
            name: '',
            comp: 'temperature_step',
            read_xform: (raw) => (raw === 1 ? 'ONE_DEGREE' : 'HALF_DEGREE'),
            write_xform: (val) => (val === 'ONE_DEGREE' ? 1 : 0),
            read_callback: (val) => {
                this.updateTemperatureStep(val === 'ONE_DEGREE' ? 1 : 0.5)
                return true
            },
        })

        config.components.filter_used = {
            platform: 'sensor',
            unique_id: '$deviceid-filter-used',
            state_topic: '$this/filter_used',
            name: '필터 사용량',
            icon: 'mdi:air-filter',
            unit_of_measurement: '%',
            state_class: 'measurement',
            entity_category: 'diagnostic',
        } as unknown as DeviceDiscovery['components'][string]
        for (const id of [0x355, 0x356]) {
            this.addField(
                config,
                {
                    id,
                    name: '',
                    comp: 'filter_used',
                    readable: false,
                    writable: false,
                    read_callback: () => {
                        this.publishFilterDetails()
                        return false
                    },
                },
                false,
            )
        }
        config.components.filter_reset = {
            platform: 'button',
            unique_id: '$deviceid-filter-reset',
            command_topic: '$this/filter_reset/set',
            name: '필터 사용량 초기화',
            icon: 'mdi:air-filter-remove',
            entity_category: 'diagnostic',
        } as unknown as DeviceDiscovery['components'][string]
        this.fields_by_ha.filter_reset = {
            name: '',
            comp: '',
            readable: false,
            write_xform: (val) => (val === 'PRESS' ? 1 : undefined),
            write_callback: () => {
                this.send([1, 1, 2, 1, 1], [{ t: 0x355, v: 0 }])
                return false
            },
        }

        // PAC uses one power tag and five consecutive fan values. Present
        // them as a single selector so "꺼짐" replaces the separate switch.
        delete config.components.ai_dry_power
        config.components.ai_dry = {
            platform: 'select',
            unique_id: '$deviceid-ai-dry',
            name: 'AI 건조 풍량',
            icon: 'mdi:fan',
            entity_category: 'config',
            options: ['AI_DRY_OFF', 'FAN_1', 'FAN_2', 'FAN_3', 'FAN_4', 'FAN_5'],
        } as unknown as DeviceDiscovery['components'][string]
        this.addField(config, {
            name: '',
            comp: 'ai_dry',
            write_xform: (val) => (val === 'AI_DRY_OFF' ? 0 : Number(val.replace('FAN_', '')) + 1),
            write_callback: (val) => {
                if (val === 0) {
                    this.raw_clip_state[0x20e] = 0
                    this.send([1, 1, 2, 1, 1], [{ t: 0x20e, v: 0 }])
                } else {
                    this.raw_clip_state[0x20e] = 255
                    this.raw_clip_state[0x1f2] = val
                    this.send(
                        [1, 1, 2, 1, 1],
                        [
                            { t: 0x20e, v: 255 },
                            { t: 0x1f2, v: val },
                        ],
                    )
                }
                return false
            },
        })

        this.addConfigSwitchField(config, 0x2a2, 'uvnano', 'UVnano', 'mdi:shield-sun')
        this.addConfigSwitchField(config, 0x20f, 'airclean', '공기 청정', 'mdi:air-purifier')
        this.addConfigSwitchField(config, 0x20d, 'energysave', '절전', 'mdi:leaf')
        this.addConfigSwitchField(config, 0x236, 'jet', '파워 냉방', 'mdi:snowflake')
        this.addConfigSwitchFieldWithValues(config, 0x165, 'all_cleaning', '올클리닝', 'mdi:air-filter', 100, 0)

        this.addStandbyScreenConfig(config)

        config.components.air_quality_sensor = {
            platform: 'select',
            unique_id: '$deviceid-air-quality-sensor',
            name: '공기질 센서',
            icon: 'mdi:air-filter',
            entity_category: 'config',
            options: ['ON_WORKING', 'ALWAYS'],
        } as unknown as DeviceDiscovery['components'][string]
        this.addField(config, {
            id: 0x337,
            name: '',
            comp: 'air_quality_sensor',
            read_xform: (raw) => (raw ? 'ALWAYS' : 'ON_WORKING'),
            write_xform: (val) => (val === 'ALWAYS' ? 1 : 0),
            write_callback: (val) => {
                this.sendPrivCommand(0x0c, 0x01, Buffer.from([0, 0, 0, val]))
                return false
            },
        })

        config.components.quiet = {
            platform: 'switch',
            unique_id: '$deviceid-quiet',
            name: '저소음 냉방',
            icon: 'mdi:volume-low',
            entity_category: 'config',
            availability: this.modeAvailability('quiet_availability'),
            availability_mode: 'all',
        } as unknown as DeviceDiscovery['components'][string]
        this.addField(config, {
            id: 0x29d,
            name: '',
            comp: 'quiet',
            read_xform: (raw) => (raw ? 'ON' : 'OFF'),
            write_xform: (val) => (val === 'ON' ? 1 : 0),
            write_callback: (val) =>
                val === 0 ||
                (this.raw_clip_state[fields.power] !== 0 && this.raw_clip_state[fields.mode] === 0),
        })
        config.components.space_airflow = {
            platform: 'switch',
            unique_id: '$deviceid-space_airflow',
            name: '공간맞춤 바람',
            icon: 'mdi:air-filter',
            entity_category: 'config',
            availability: this.modeAvailability('space_airflow_availability'),
            availability_mode: 'all',
        } as unknown as DeviceDiscovery['components'][string]
        this.addField(config, {
            id: 0x1be,
            name: '',
            comp: 'space_airflow',
            read_xform: (raw) => (raw ? 'ON' : 'OFF'),
            write_xform: (val) => (val === 'ON' ? 1 : 0),
            write_callback: (val) =>
                val === 0 ||
                (this.raw_clip_state[fields.power] !== 0 && this.raw_clip_state[fields.mode] === 0),
        })
        config.components.outlet = {
            platform: 'switch',
            unique_id: '$deviceid-outlet',
            name: '토출구 열기',
            icon: 'mdi:air-conditioner',
            entity_category: 'config',
            availability: this.modeAvailability('outlet_availability'),
            availability_mode: 'all',
        } as unknown as DeviceDiscovery['components'][string]
        this.addField(config, {
            id: 0x392,
            name: '',
            comp: 'outlet',
            read_xform: (raw) => (raw ? 'ON' : 'OFF'),
            write_xform: (val) => (val === 'ON' ? 1 : 0),
            write_callback: () => this.raw_clip_state[fields.power] === 0,
        })
        this.addConfigSwitchField(config, 0x3a9, 'button_lock', '버튼 잠금', 'mdi:lock')

        const addSelect = (id: number, name: string, desc: string, options: string[], values: number[]) => {
            config.components[name] = {
                platform: 'select',
                unique_id: `$deviceid-${name}`,
                name: desc,
                options,
                entity_category: 'config',
            } as unknown as DeviceDiscovery['components'][string]
            this.addField(config, {
                id,
                name: '',
                comp: name,
                read_xform: (raw) => options[values.indexOf(raw)],
                write_xform: (val) => values[options.indexOf(val)],
            })
        }
        addSelect(0x2a8, 'one_side_airflow', '한쪽 바람', ['RELEASE', 'LEFT', 'RIGHT'], [0, 1, 2])
        addSelect(0x3aa, 'lighting_mode', '라이팅 모드', ['OVERALL_AIR_QUALITY', 'OPERATION_STATUS'], [1, 10])
        addSelect(0x3ac, 'lighting_brightness', '라이팅 밝기', ['20%', '40%', '60%', '80%', '100%'], [20, 40, 60, 80, 100])
        addSelect(0x21f, 'display_light', '제품 화면 밝기', ['OFF', '20%', '40%', '60%', '80%', '100%'], [100, 120, 140, 160, 180, 200])
        addSelect(0x3a0, 'button_sound', '제품 소리 크기', ['OFF', '20%', '40%', '60%', '80%', '100%'], [100, 120, 140, 160, 180, 200])
    }

    processData(buf: Buffer) {
        if (
            buf.length >= 13 &&
            buf[0] === 0 &&
            buf[1] === 0 &&
            buf[2] === 4 &&
            buf[6] === 0xa7 &&
            buf[7] === 2 &&
            buf[8] === 4 &&
            buf[10] === buf.length - 13
        ) {
            this.processTLV(TLV.parse(buf.subarray(11, buf.length - 2)))
            return
        }
        if (buf.length >= 287 && buf[0] === 0 && buf[1] === 0 && buf[2] === 4 && buf[6] === 0xa8 && buf[7] === 0x67) {
            this.processStatus(buf)
            return
        }
        super.processData(buf)
    }

    private processStatus(buf: Buffer) {
        this.processKeyValue(fields.power, buf[17])
        this.processKeyValue(fields.mode, buf[18])
        this.processKeyValue(fields.fanSpeed, buf[20])
        this.processKeyValue(fields.targetTemperature, buf[33])
        this.processKeyValue(fields.currentTemperature, buf[34])
        this.HA.publishProperty(this.id, 'pm2_5', buf[57])
        this.HA.publishProperty(this.id, 'pm1', buf[55])
        this.HA.publishProperty(this.id, 'pm10', buf[59])
        this.HA.publishProperty(this.id, 'humidity', buf[60])
        this.HA.publishProperty(
            this.id,
            'air_quality',
            ({
                0: 'AIR_QUALITY_UNKNOWN',
                1: 'AIR_QUALITY_GOOD',
                2: 'AIR_QUALITY_NORMAL',
                3: 'AIR_QUALITY_BAD',
                4: 'AIR_QUALITY_VERY_BAD',
            } as Record<number, string>)[buf[68]] ?? 'AIR_QUALITY_UNKNOWN',
        )
        this.HA.publishProperty(this.id, 'filter_remaining', buf[286])
        this.updatePacClimateAction(buf[160] !== 0)
    }

    private updateTemperatureStep(step: 0.5 | 1) {
        const climate = this.config?.components.climate as unknown as Record<string, unknown> | undefined
        if (!climate || climate.temp_step === step) return
        climate.temp_step = step
        climate.precision = step
        this.publishConfig()
    }

    private publishFilterDetails() {
        const remaining = this.raw_clip_state[0x355]
        const life = this.raw_clip_state[0x356]
        if (remaining == null || life == null || life <= 0) return
        const remainingPercent = Math.max(0, Math.min(100, Math.round((remaining / life) * 100)))
        this.HA.publishProperty(this.id, 'filter_used', 100 - remainingPercent)
        this.HA.publishProperty(this.id, 'filter_remaining', remainingPercent)
    }

    private updatePacClimateAction(compressorRunning: boolean) {
        const power = this.raw_clip_state[fields.power]
        const mode = this.raw_clip_state[fields.mode]
        let action: string | undefined
        if (power === 0) action = 'off'
        else if (mode === 5) action = 'fan'
        else if (!compressorRunning) action = 'idle'
        else if (mode === 0) action = 'cooling'
        else if (mode === 1) action = 'drying'
        if (action) this.HA.publishProperty(this.id, 'climate-action', action)
    }

    processKeyValue(id: number, value: number) {
        if (id === 0x20e || id === 0x1f2) {
            this.raw_clip_state[id] = value
            const level = this.raw_clip_state[0x1f2]
            const state = this.raw_clip_state[0x20e] === 255 && level >= 2 && level <= 6 ? `FAN_${level - 1}` : 'AI_DRY_OFF'
            this.HA.publishProperty(this.id, 'ai_dry-', state)
            return
        }
        if (id === fields.mode && value === 5) {
            this.raw_clip_state[id] = value
            this.HA.publishProperty(this.id, 'climate-mode', 'fan_only')
            this.HA.publishProperty(this.id, 'climate-preset_mode', 'AIR_PURIFY')
            this.updateModeAvailability()
            this.updateFanModeOptions()
            return
        }
        super.processKeyValue(id, value)
        if (id === fields.power || id === fields.mode) this.updateModeAvailability()
        if (id === fields.mode) this.updateFanModeOptions()
    }

    private modeAvailability(topic: string) {
        return [{ topic: '$this/availability' }, { topic: '$rethink/availability' }, { topic: `$this/${topic}` }]
    }

    private updateModeAvailability() {
        const cooling = this.raw_clip_state[fields.power] !== 0 && this.raw_clip_state[fields.mode] === 0
        const off = this.raw_clip_state[fields.power] === 0
        this.HA.publishProperty(this.id, 'space_airflow_availability', cooling ? 'online' : 'offline')
        this.HA.publishProperty(this.id, 'quiet_availability', cooling ? 'online' : 'offline')
        this.HA.publishProperty(this.id, 'outlet_availability', off ? 'online' : 'offline')
    }

    private addStandbyScreenConfig(config: DeviceDiscovery) {
        const addStandbySwitch = (id: number, component: string, name: string, availabilityTopic?: string) => {
            config.components[component] = {
                platform: 'switch',
                unique_id: `$deviceid-${component}`,
                name,
                icon: 'mdi:monitor',
                entity_category: 'config',
                ...(availabilityTopic
                    ? { availability: this.modeAvailability(availabilityTopic), availability_mode: 'all' }
                    : {}),
            } as unknown as DeviceDiscovery['components'][string]
            this.addField(config, {
                id,
                name: '',
                comp: component,
                read_xform: (raw) => (raw ? 'ON' : 'OFF'),
                write_xform: (value) => (value === 'ON' ? 1 : 0),
                read_callback: () => {
                    this.updateStandbyAvailability()
                    return true
                },
                write_callback: (value) => {
                    if (id === fields.standbyPower) {
                        this.raw_clip_state[id] = value
                        this.send([1, 1, 2, 1, 1], [{ t: id, v: value }])
                        if (value !== 0 && this.raw_clip_state[fields.standbyClock] !== 0)
                            this.scheduleStandbyTimeSync()
                        else this.cancelStandbyTimeSync()
                        this.updateStandbyAvailability()
                        return false
                    }
                    return this.writeStandbySetting(id, value)
                },
            })
        }

        addStandbySwitch(fields.standbyPower, 'standby_screen', '대기 화면')
        addStandbySwitch(fields.standbyIndoorAir, 'standby_indoor_air', '대기 화면 실내 공기', 'standby_children_availability')
        addStandbySwitch(
            fields.standbyOutdoorAir,
            'standby_outdoor_air',
            '대기 화면 실외 공기',
            'standby_children_availability',
        )
        addStandbySwitch(fields.standbyClock, 'standby_clock', '대기 화면 현재 시간', 'standby_children_availability')
        addStandbySwitch(fields.standbyDate, 'standby_date', '대기 화면 날짜 표시', 'standby_clock_availability')
        addStandbySwitch(
            fields.standbyAutoSwitch,
            'standby_auto_switch',
            '대기 화면 자동 전환',
            'standby_auto_availability',
        )

        config.components.standby_time_sync = {
            platform: 'button',
            unique_id: '$deviceid-standby_time_sync',
            command_topic: '$this/standby_time_sync/set',
            name: '현재 시간 강제 동기화',
            icon: 'mdi:clock-sync-outline',
            entity_category: 'config',
            availability: this.modeAvailability('standby_clock_availability'),
            availability_mode: 'all',
        } as unknown as DeviceDiscovery['components'][string]
        this.fields_by_ha.standby_time_sync = {
            name: '',
            comp: '',
            readable: false,
            write_xform: (value) => (value === 'PRESS' ? 1 : undefined),
            write_callback: () => {
                this.thinq.requestTimeSync('PAC manual clock sync button')
                return false
            },
        }

        config.components.standby_time_format = {
            platform: 'select',
            unique_id: '$deviceid-standby_time_format',
            name: '대기 화면 시간 형식',
            icon: 'mdi:clock-outline',
            options: ['HOUR_12', 'HOUR_24'],
            entity_category: 'config',
            availability: this.modeAvailability('standby_clock_availability'),
            availability_mode: 'all',
        } as unknown as DeviceDiscovery['components'][string]
        this.addField(config, {
            id: fields.standbyTimeFormat,
            name: '',
            comp: 'standby_time_format',
            read_xform: (raw) => (raw ? 'HOUR_24' : 'HOUR_12'),
            write_xform: (value) => (value === 'HOUR_24' ? 1 : 0),
            read_callback: () => {
                this.updateStandbyAvailability()
                return true
            },
            write_callback: (value) => this.writeStandbySetting(fields.standbyTimeFormat, value),
        })

        const intervalOptions = ['SEC_10', 'SEC_30', 'MIN_1', 'MIN_3', 'MIN_5', 'MIN_10']
        const intervalValues = [10, 30, 60, 180, 300, 600]
        config.components.standby_switch_interval = {
            platform: 'select',
            unique_id: '$deviceid-standby_switch_interval',
            name: '대기 화면 전환 시간',
            icon: 'mdi:timer-outline',
            options: intervalOptions,
            entity_category: 'config',
            availability: this.modeAvailability('standby_interval_availability'),
            availability_mode: 'all',
        } as unknown as DeviceDiscovery['components'][string]
        this.addField(config, {
            id: fields.standbyInterval,
            name: '',
            comp: 'standby_switch_interval',
            read_xform: (raw) => intervalOptions[intervalValues.indexOf(raw)],
            write_xform: (value) => intervalValues[intervalOptions.indexOf(value)],
            read_callback: () => {
                this.updateStandbyAvailability()
                return true
            },
            write_callback: (value) => this.writeStandbySetting(fields.standbyInterval, value),
        })
    }

    private writeStandbySetting(id: number, value: number) {
        if (standbyTypeFields.includes(id as (typeof standbyTypeFields)[number]) && value === 0) {
            const otherSelected = standbyTypeFields.some((field) => field !== id && this.raw_clip_state[field] !== 0)
            if (!otherSelected) return false
        }

        this.raw_clip_state[id] = value
        const selectedCount = standbyTypeFields.filter((field) => this.raw_clip_state[field] !== 0).length
        // The ThinQ app disables auto rotation when only one standby screen is
        // selected. Persist the same rule in the appliance; merely hiding the
        // HA control leaves PAC rotating to an unselected, blank screen.
        if (selectedCount <= 1) this.raw_clip_state[fields.standbyAutoSwitch] = 0
        const defaults: Record<number, number> = {
            [fields.standbyIndoorAir]: 1,
            [fields.standbyTimeFormat]: 1,
            [fields.standbyPower]: 1,
            [fields.standbyDate]: 1,
            [fields.standbyInterval]: 10,
            [fields.standbyOutdoorAir]: 0,
            [fields.standbyAutoSwitch]: 0,
            [fields.standbyClock]: 0,
        }
        this.send(
            [1, 1, 2, 1, 1],
            standbyFields.map((field) => ({ t: field, v: this.raw_clip_state[field] ?? defaults[field] })),
        )
        if (
            this.raw_clip_state[fields.standbyPower] !== 0 &&
            this.raw_clip_state[fields.standbyClock] !== 0 &&
            (id === fields.standbyClock || id === fields.standbyDate || id === fields.standbyTimeFormat)
        )
            this.scheduleStandbyTimeSync()
        else if (id === fields.standbyClock) this.cancelStandbyTimeSync()
        this.updateStandbyAvailability()
        return false
    }

    private scheduleStandbyTimeSync() {
        this.cancelStandbyTimeSync()
        // PAC does not request a fresh clock after standby-screen changes. Let
        // the setting acknowledgement settle, then refresh the clock exactly
        // once; repeated unsolicited responses can make this firmware blank it.
        this.standbyTimeSyncTimeout = setTimeout(() => {
            this.standbyTimeSyncTimeout = undefined
            this.thinq.requestTimeSync('PAC standby clock refresh')
        }, 750)
    }

    private cancelStandbyTimeSync() {
        if (this.standbyTimeSyncTimeout == undefined) return
        clearTimeout(this.standbyTimeSyncTimeout)
        this.standbyTimeSyncTimeout = undefined
    }

    private updateStandbyAvailability() {
        const enabled = this.raw_clip_state[fields.standbyPower] !== 0
        const selectedCount = standbyTypeFields.filter((field) => this.raw_clip_state[field] !== 0).length
        const clockEnabled = enabled && this.raw_clip_state[fields.standbyClock] !== 0
        const autoAvailable = enabled && selectedCount > 1
        const intervalAvailable = autoAvailable && this.raw_clip_state[fields.standbyAutoSwitch] !== 0

        this.HA.publishProperty(this.id, 'standby_children_availability', enabled ? 'online' : 'offline')
        this.HA.publishProperty(this.id, 'standby_clock_availability', clockEnabled ? 'online' : 'offline')
        this.HA.publishProperty(this.id, 'standby_auto_availability', autoAvailable ? 'online' : 'offline')
        this.HA.publishProperty(this.id, 'standby_interval_availability', intervalAvailable ? 'online' : 'offline')
    }

    private updateFanModeOptions() {
        const profile = this.raw_clip_state[fields.mode] === 1 ? 'dry' : 'levels'
        if (profile === this.fanModeProfile) return
        this.fanModeProfile = profile
        if (!this.config) return

        const climate = this.config.components.climate as unknown as Record<string, unknown>
        climate.fan_modes = displayOptions(
            profile === 'dry' ? ['FAN_AUTO'] : ['FAN_1', 'FAN_2', 'FAN_3', 'FAN_4', 'FAN_5'],
            AC_DISPLAY_LABELS,
        )
        this.publishConfig()
    }

    setProperty(prop: string, value: string) {
        if (prop === 'climate-preset_mode' && value === 'AIR_PURIFY') {
            this.raw_clip_state[fields.power] = 1
            this.raw_clip_state[fields.mode] = 5
            this.send(
                [1, 1, 2, 1, 1],
                [
                    { t: fields.power, v: 1 },
                    { t: fields.mode, v: 5 },
                    { t: fields.fanSpeed, v: this.raw_clip_state[fields.fanSpeed] },
                    { t: fields.targetTemperature, v: this.raw_clip_state[fields.targetTemperature] },
                ],
            )
            return
        }
        if (prop === 'climate-mode' && value === 'fan_only') {
            this.raw_clip_state[fields.power] = 1
            this.raw_clip_state[fields.mode] = 5
            this.send(
                [1, 1, 2, 1, 1],
                [
                    { t: fields.power, v: 1 },
                    { t: fields.mode, v: 5 },
                    { t: fields.fanSpeed, v: this.raw_clip_state[fields.fanSpeed] },
                    { t: fields.targetTemperature, v: this.raw_clip_state[fields.targetTemperature] },
                ],
            )
            return
        }
        super.setProperty(prop, value)
    }
}

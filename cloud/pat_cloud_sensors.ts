import type { ComponentInfo, DeviceDiscovery } from './homeassistant'
import { allowExtendedType } from '@/util/casting'

export type PatCloudSource = 'state' | 'energy'
export type PatCloudUnit = 'main' | 'washer' | 'dryer'

export type PatCloudReading = {
    key: string
    name: string
    value: string | number
    source: PatCloudSource
    unit?: string
    deviceClass?: string
    stateClass?: string
    icon?: string
}

export type PatCloudGroup = {
    unit: PatCloudUnit
    readings: PatCloudReading[]
}

type SensorDefinition = Omit<PatCloudReading, 'value' | 'source'> & { path: string }

type LocalComponentMap = Partial<Record<PatCloudUnit, Record<string, string[]>>>

// A PAT value is hidden only when the connected local device actually
// publishes one of the listed components. This keeps cloud-only values while
// avoiding duplicate entities on models whose local packet mapping is complete.
const LOCAL_COMPONENTS: Record<string, LocalComponentMap> = {
    DEVICE_AIR_CONDITIONER: {
        main: {
            current_job_mode: ['climate'],
            operation_mode: ['climate'],
            air_clean_mode: ['air_purify'],
            current_temperature: ['climate'],
            target_temperature: ['climate'],
            pm1: ['pm1'],
            pm2_5: ['pm2_5'],
            pm10: ['pm10'],
            humidity: ['humidity'],
            pollution_level: ['air_quality'],
            monitoring: ['air_quality_sensor'],
            filter_used_time: ['filter_used_time'],
            filter_lifetime: ['filter_remaining_time'],
            filter_remaining: ['filter_remaining'],
            wind_strength: ['climate'],
            wind_step: ['climate'],
            wind_up_down: ['climate'],
            wind_left_right: ['climate'],
            display_light: ['display_light'],
            sleep_stop_timer: ['sleep_timer'],
            error: ['error', 'error_code'],
        },
    },
    DEVICE_DISH_WASHER: {
        main: {
            current_state: ['state'],
            rinse_level: ['rinse_level'],
            softening_level: ['salt_level'],
            machine_clean_reminder: ['clean_reminder'],
            signal_level: ['buzzer'],
            clean_light_reminder: ['end_alarm'],
            door_state: ['door'],
            operation_mode: ['operation'],
            remote_control: ['remote_start_active', 'remote_mode'],
            course: ['course'],
            remaining_time: ['remaining_time'],
            total_time: ['initial_time'],
            delay_start: ['delay_start'],
        },
    },
    DEVICE_WASHTOWER: {
        washer: {
            current_state: ['washer_state'],
            operation_mode: ['washer_operation'],
            remote_control: ['washer_remote_start'],
            cycle_count: ['washer_cycle_count'],
            remaining_time: ['washer_remaining_time'],
            total_time: ['washer_initial_time'],
            delay_start: ['washer_reserve_time'],
            delay_end: ['washer_delay_ends_at'],
            error: ['washer_error'],
        },
        dryer: {
            current_state: ['dryer_state'],
            operation_mode: ['dryer_operation'],
            remote_control: ['dryer_remote_start'],
            remaining_time: ['dryer_remaining_time'],
            total_time: ['dryer_initial_time'],
            delay_start: ['dryer_reserve_time'],
            delay_end: ['dryer_delay_ends_at'],
            error: ['dryer_error'],
        },
    },
    DEVICE_STICK_CLEANER: {
        main: {
            current_state: ['current_state'],
            current_job_mode: ['operation_mode'],
            battery_level: ['battery'],
            battery_percent: ['battery'],
        },
    },
    DEVICE_REFRIGERATOR: {
        main: {
            rapid_freeze: ['express_freeze'],
            express_mode: ['express_cool_status'],
            express_fridge: ['express_cool_status'],
            fresh_air_filter: ['pure_n_fresh'],
            door_state: ['door'],
            fridge_temperature: ['fridge_setpoint'],
            freezer_temperature: ['freezer_setpoint'],
        },
    },
    DEVICE_DEHUMIDIFIER: {
        main: {
            operation_mode: ['humidifier', 'power'],
            current_job_mode: ['operating_mode'],
            current_humidity: ['current_humidity'],
            target_humidity: ['target_humidity'],
            wind_strength: ['fan_speed'],
            absolute_stop_timer: ['off_timer'],
        },
    },
}

LOCAL_COMPONENTS.DEVICE_WASHTOWER_WASHER = { washer: LOCAL_COMPONENTS.DEVICE_WASHTOWER.washer! }
LOCAL_COMPONENTS.DEVICE_WASHTOWER_DRYER = { dryer: LOCAL_COMPONENTS.DEVICE_WASHTOWER.dryer! }

const COMMON_ERROR: SensorDefinition = {
    key: 'error',
    path: 'error',
    name: '오류 상태',
    icon: 'mdi:alert-circle-outline',
}

const APPLIANCE_TIMER: SensorDefinition[] = [
    { key: 'remaining_time', path: '$remainingMinutes', name: '남은 시간', unit: 'min', deviceClass: 'duration' },
    { key: 'total_time', path: '$totalMinutes', name: '전체 운전 시간', unit: 'min', deviceClass: 'duration' },
    { key: 'delay_start', path: '$delayStartMinutes', name: '예약 시작', unit: 'min', deviceClass: 'duration' },
    { key: 'delay_end', path: '$delayEndMinutes', name: '예약 종료', unit: 'min', deviceClass: 'duration' },
]

const DEFINITIONS: Record<string, SensorDefinition[]> = {
    DEVICE_DISH_WASHER: [
        { key: 'current_state', path: 'runState.currentState', name: '현재 상태' },
        { key: 'rinse_refill', path: 'dishWashingStatus.rinseRefill', name: '린스 보충 필요' },
        { key: 'rinse_level', path: 'preference.rinseLevel', name: '린스 단계' },
        { key: 'softening_level', path: 'preference.softeningLevel', name: '연수 단계' },
        { key: 'machine_clean_reminder', path: 'preference.mCReminder', name: '통살균 알림' },
        { key: 'signal_level', path: 'preference.signalLevel', name: '알림음 단계' },
        { key: 'clean_light_reminder', path: 'preference.cleanLReminder', name: '완료 표시 알림' },
        { key: 'door_state', path: 'doorStatus.doorState', name: '문 상태' },
        { key: 'operation_mode', path: 'operation.dishWasherOperationMode', name: '운전 모드' },
        { key: 'remote_control', path: 'remoteControlEnable.remoteControlEnabled', name: '원격 제어 가능 상태' },
        { key: 'course', path: 'dishWashingCourse.currentDishWashingCourse', name: '현재 코스' },
        ...APPLIANCE_TIMER,
        COMMON_ERROR,
    ],
    DEVICE_WASHER: [
        { key: 'current_state', path: 'runState.currentState', name: '현재 상태' },
        { key: 'operation_mode', path: 'operation.washerOperationMode', name: '운전 모드' },
        { key: 'remote_control', path: 'remoteControlEnable.remoteControlEnabled', name: '원격 제어 가능 상태' },
        { key: 'detergent_setting', path: 'detergent.detergentSetting', name: '세제 설정' },
        { key: 'cycle_count', path: 'cycle.cycleCount', name: '누적 사용 횟수', icon: 'mdi:counter' },
        ...APPLIANCE_TIMER,
        COMMON_ERROR,
    ],
    DEVICE_DRYER: [
        { key: 'current_state', path: 'runState.currentState', name: '현재 상태' },
        { key: 'operation_mode', path: 'operation.dryerOperationMode', name: '운전 모드' },
        { key: 'remote_control', path: 'remoteControlEnable.remoteControlEnabled', name: '원격 제어 가능 상태' },
        ...APPLIANCE_TIMER,
        COMMON_ERROR,
    ],
    DEVICE_DEHUMIDIFIER: [
        { key: 'operation_mode', path: 'operation.dehumidifierOperationMode', name: '운전 상태' },
        { key: 'current_job_mode', path: 'dehumidifierJobMode.currentJobMode', name: '운전 모드' },
        {
            key: 'current_humidity',
            path: 'humidity.currentHumidity',
            name: '현재 습도',
            unit: '%',
            deviceClass: 'humidity',
        },
        {
            key: 'target_humidity',
            path: 'humidity.targetHumidity',
            name: '목표 습도',
            unit: '%',
            deviceClass: 'humidity',
        },
        { key: 'wind_strength', path: 'airFlow.windStrengthLevel', name: '풍량' },
        { key: 'absolute_start_timer', path: 'timer.absoluteStartTimer', name: '켜짐 예약 상태' },
        { key: 'absolute_stop_timer', path: 'timer.absoluteStopTimer', name: '꺼짐 예약 상태' },
        { key: 'sleep_stop_timer', path: 'sleepTimer.relativeStopTimer', name: '취침 예약 상태' },
        ...APPLIANCE_TIMER,
        COMMON_ERROR,
    ],
    DEVICE_STICK_CLEANER: [
        { key: 'current_state', path: 'runState.currentState', name: '현재 상태' },
        { key: 'current_state_detail', path: 'runState.currentStateDetail', name: '현재 상태 상세' },
        { key: 'current_job_mode', path: 'stickCleanerJobMode.currentJobMode', name: '작업 모드' },
        {
            key: 'current_job_mode_detail',
            path: 'stickCleanerJobMode.currentJobModeDetail',
            name: '작업 모드 상세',
        },
        { key: 'battery_level', path: 'battery.level', name: '배터리 단계', icon: 'mdi:battery' },
        {
            key: 'battery_percent',
            path: 'battery.percent',
            name: '배터리 잔량',
            unit: '%',
            deviceClass: 'battery',
            stateClass: 'measurement',
        },
        COMMON_ERROR,
    ],
    DEVICE_AIR_CONDITIONER: [
        { key: 'current_state', path: 'runState.currentState', name: '현재 상태' },
        { key: 'current_job_mode', path: 'airConJobMode.currentJobMode', name: '운전 모드' },
        { key: 'operation_mode', path: 'operation.airConOperationMode', name: '운전 상태' },
        { key: 'air_clean_mode', path: 'operation.airCleanOperationMode', name: '공기 청정 운전 상태' },
        {
            key: 'current_temperature',
            path: 'temperature.currentTemperature',
            name: '현재 온도',
            unit: '°C',
            deviceClass: 'temperature',
            stateClass: 'measurement',
        },
        {
            key: 'target_temperature',
            path: 'temperature.targetTemperature',
            name: '설정 온도',
            unit: '°C',
            deviceClass: 'temperature',
            stateClass: 'measurement',
        },
        {
            key: 'pm1',
            path: 'airQualitySensor.PM1',
            name: 'PM1.0',
            unit: 'µg/m³',
            deviceClass: 'pm1',
            stateClass: 'measurement',
        },
        {
            key: 'pm2_5',
            path: 'airQualitySensor.PM2',
            name: 'PM2.5',
            unit: 'µg/m³',
            deviceClass: 'pm25',
            stateClass: 'measurement',
        },
        {
            key: 'pm10',
            path: 'airQualitySensor.PM10',
            name: 'PM10',
            unit: 'µg/m³',
            deviceClass: 'pm10',
            stateClass: 'measurement',
        },
        {
            key: 'humidity',
            path: 'airQualitySensor.humidity',
            name: '실내 습도',
            unit: '%',
            deviceClass: 'humidity',
            stateClass: 'measurement',
        },
        { key: 'pollution', path: 'airQualitySensor.totalPollution', name: '종합 오염도', stateClass: 'measurement' },
        { key: 'pollution_level', path: 'airQualitySensor.totalPollutionLevel', name: '공기질 등급' },
        { key: 'monitoring', path: 'airQualitySensor.monitoringEnabled', name: '공기질 측정 상태' },
        {
            key: 'filter_used_time',
            path: 'filterInfo.usedTime',
            name: '필터 사용 시간',
            unit: 'h',
            deviceClass: 'duration',
        },
        {
            key: 'filter_lifetime',
            path: 'filterInfo.filterLifetime',
            name: '필터 수명',
            unit: 'h',
            deviceClass: 'duration',
        },
        {
            key: 'filter_remaining',
            path: 'filterInfo.filterRemainPercent',
            name: '필터 잔량',
            unit: '%',
            stateClass: 'measurement',
        },
        { key: 'wind_strength', path: 'airFlow.windStrength', name: '풍량' },
        { key: 'wind_step', path: 'airFlow.windStep', name: '풍량 단계' },
        { key: 'wind_up_down', path: 'windDirection.rotateUpDown', name: '상하 풍향' },
        { key: 'wind_left_right', path: 'windDirection.rotateLeftRight', name: '좌우 풍향' },
        { key: 'display_light', path: 'display.light', name: '화면 상태' },
        { key: 'absolute_start_timer', path: 'timer.absoluteStartTimer', name: '켜짐 예약 상태' },
        { key: 'absolute_stop_timer', path: 'timer.absoluteStopTimer', name: '꺼짐 예약 상태' },
        { key: 'sleep_stop_timer', path: 'sleepTimer.relativeStopTimer', name: '취침 예약 상태' },
        ...APPLIANCE_TIMER,
        COMMON_ERROR,
    ],
    DEVICE_REFRIGERATOR: [
        { key: 'rapid_freeze', path: 'refrigeration.rapidFreeze', name: '급속 냉동 상태' },
        { key: 'express_mode', path: 'refrigeration.expressMode', name: '특급 모드' },
        { key: 'express_mode_name', path: 'refrigeration.expressModeName', name: '특급 모드 이름' },
        { key: 'express_fridge', path: 'refrigeration.expressFridge', name: '급속 냉장 상태' },
        { key: 'fresh_air_filter', path: 'refrigeration.freshAirFilter', name: '청정 탈취 필터 상태' },
        {
            key: 'fresh_air_filter_remaining',
            path: 'refrigeration.freshAirFilterRemainPercent',
            name: '청정 탈취 필터 잔량',
            unit: '%',
            stateClass: 'measurement',
        },
        { key: 'water_filter_state', path: 'waterFilterInfo.waterFilterState', name: '정수 필터 상태' },
        {
            key: 'water_filter_1_remaining',
            path: 'waterFilterInfo.waterFilter1RemainPercent',
            name: '정수 필터 1 잔량',
            unit: '%',
            stateClass: 'measurement',
        },
        {
            key: 'water_filter_2_remaining',
            path: 'waterFilterInfo.waterFilter2RemainPercent',
            name: '정수 필터 2 잔량',
            unit: '%',
            stateClass: 'measurement',
        },
        {
            key: 'water_filter_3_remaining',
            path: 'waterFilterInfo.waterFilter3RemainPercent',
            name: '정수 필터 3 잔량',
            unit: '%',
            stateClass: 'measurement',
        },
        COMMON_ERROR,
    ],
}

function objectAt(value: unknown, path: string): unknown {
    let current = value
    for (const key of path.split('.')) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
        current = (current as Record<string, unknown>)[key]
    }
    return current
}

function minutes(state: unknown, prefix: string): number | undefined {
    const hour = Number(objectAt(state, `timer.${prefix}Hour`))
    const minute = Number(objectAt(state, `timer.${prefix}Minute`))
    if (!Number.isFinite(hour) && !Number.isFinite(minute)) return undefined
    return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0)
}

function computedValue(state: unknown, path: string): unknown {
    if (path === '$remainingMinutes') return minutes(state, 'remain')
    if (path === '$totalMinutes') return minutes(state, 'total')
    if (path === '$delayStartMinutes' || path === '$delayEndMinutes') {
        const suffix = path === '$delayStartMinutes' ? 'Start' : 'Stop'
        const hour = Number(objectAt(state, `timer.relativeHourTo${suffix}`))
        const minute = Number(objectAt(state, `timer.relativeMinuteTo${suffix}`))
        if (!Number.isFinite(hour) && !Number.isFinite(minute)) return undefined
        return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0)
    }
    return objectAt(state, path)
}

function scalar(value: unknown): string | number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.length) return value
    if (typeof value === 'boolean') return value ? 'ON' : 'OFF'
    if (value && typeof value === 'object') {
        const encoded = JSON.stringify(value)
        if (encoded.length <= 255) return encoded
    }
    return undefined
}

function stateReadings(deviceType: string, state: unknown): PatCloudReading[] {
    return (DEFINITIONS[deviceType] ?? []).flatMap((definition) => {
        const value = scalar(computedValue(state, definition.path))
        return value === undefined ? [] : [{ ...definition, value, source: 'state' as const }]
    })
}

function locationValue(state: unknown, resource: string, location: string, property: string): unknown {
    const entries = objectAt(state, resource)
    if (!Array.isArray(entries)) return undefined
    const match = entries.find((entry) => {
        if (!entry || typeof entry !== 'object') return false
        const item = entry as Record<string, unknown>
        return item.locationName === location || objectAt(item, 'location.locationName') === location
    })
    return match && typeof match === 'object' ? (match as Record<string, unknown>)[property] : undefined
}

function refrigeratorLocationReadings(state: unknown): PatCloudReading[] {
    const definitions: Array<[string, string, string, string, string?, string?]> = [
        ['door_state', '문 상태', 'doorStatus', 'MAIN'],
        ['fridge_temperature', '냉장실 설정 온도', 'temperatureInUnits', 'FRIDGE', '°C', 'temperature'],
        ['freezer_temperature', '냉동실 설정 온도', 'temperatureInUnits', 'FREEZER', '°C', 'temperature'],
    ]
    return definitions.flatMap(([key, name, resource, location, unit, deviceClass]) => {
        const property = resource === 'doorStatus' ? 'doorState' : 'targetTemperatureC'
        const value = scalar(locationValue(state, resource, location, property))
        return value === undefined
            ? []
            : [
                  {
                      key,
                      name,
                      value,
                      source: 'state' as const,
                      unit,
                      deviceClass,
                      stateClass: unit ? 'measurement' : undefined,
                  },
              ]
    })
}

function energyReading(value: unknown): PatCloudReading[] {
    const wattHours = scalar(value)
    if (wattHours === undefined) return []
    return [
        {
            key: 'daily_energy_usage',
            name: '오늘 전력 사용량',
            value: wattHours,
            source: 'energy',
            unit: 'Wh',
            deviceClass: 'energy',
            stateClass: 'total',
            icon: 'mdi:lightning-bolt',
        },
    ]
}

function unfilteredPatCloudGroups(
    deviceType: string,
    state: unknown,
    dailyEnergy: Record<string, number>,
): PatCloudGroup[] {
    if (deviceType === 'DEVICE_WASHTOWER') {
        return [
            {
                unit: 'washer',
                readings: [
                    ...stateReadings('DEVICE_WASHER', objectAt(state, 'washer')),
                    ...energyReading(dailyEnergy.energyUsage_washer),
                ],
            },
            {
                unit: 'dryer',
                readings: [
                    ...stateReadings('DEVICE_DRYER', objectAt(state, 'dryer')),
                    ...energyReading(dailyEnergy.energyUsage_dryer),
                ],
            },
        ].filter((group) => group.readings.length) as PatCloudGroup[]
    }

    if (deviceType === 'DEVICE_WASHTOWER_WASHER' || deviceType === 'DEVICE_WASHTOWER_DRYER') {
        const unit = deviceType === 'DEVICE_WASHTOWER_WASHER' ? 'washer' : 'dryer'
        const applianceType = unit === 'washer' ? 'DEVICE_WASHER' : 'DEVICE_DRYER'
        const energy = dailyEnergy[`energyUsage_${unit}`] ?? dailyEnergy.energyUsage
        const readings = [...stateReadings(applianceType, state), ...energyReading(energy)]
        return readings.length ? [{ unit, readings }] : []
    }

    const readings = [
        ...stateReadings(deviceType, state),
        ...(deviceType === 'DEVICE_REFRIGERATOR' ? refrigeratorLocationReadings(state) : []),
        ...energyReading(dailyEnergy.energyUsage),
    ]
    return readings.length ? [{ unit: 'main', readings }] : []
}

export function patCloudGroups(
    deviceType: string,
    state: unknown,
    dailyEnergy: Record<string, number>,
    localComponents?: ReadonlySet<string>,
): PatCloudGroup[] {
    const groups = unfilteredPatCloudGroups(deviceType, state, dailyEnergy)
    if (!localComponents?.size) return groups

    const mappings = LOCAL_COMPONENTS[deviceType]
    if (!mappings) return groups
    return groups
        .map((group) => {
            const unitMappings = mappings[group.unit] ?? {}
            return {
                ...group,
                readings: group.readings.filter((reading) => {
                    const candidates = unitMappings[reading.key] ?? []
                    return !candidates.some((component) => localComponents.has(component))
                }),
            }
        })
        .filter((group) => group.readings.length)
}

function topicPrefix(unit: PatCloudUnit) {
    return unit === 'main' ? 'pat_cloud' : `${unit}/pat_cloud`
}

export function patCloudDiscovery(alias: string, model: string, group: PatCloudGroup): DeviceDiscovery {
    const prefix = topicPrefix(group.unit)
    const identifier = group.unit === 'main' ? '$deviceid' : `$deviceid-${group.unit}`
    const unitName = group.unit === 'main' ? alias : `${alias} ${group.unit === 'washer' ? '세탁기' : '건조기'}`
    const components = Object.fromEntries(
        group.readings.map((reading) => {
            const sourceAvailability = reading.source === 'energy' ? 'energy_availability' : 'state_availability'
            const component = allowExtendedType({
                platform: 'sensor',
                name: `${reading.name} (PAT-Cloud)`,
                unique_id: `${identifier}-pat_cloud_${reading.key}`,
                state_topic: `$this/${prefix}/${reading.key}`,
                availability: [
                    { topic: '$this/availability' },
                    { topic: '$rethink/availability' },
                    { topic: `$this/pat_cloud/${sourceAvailability}` },
                ],
                availability_mode: 'all',
                ...(reading.unit ? { unit_of_measurement: reading.unit } : {}),
                ...(reading.deviceClass ? { device_class: reading.deviceClass } : {}),
                ...(reading.stateClass ? { state_class: reading.stateClass } : {}),
                ...(reading.icon ? { icon: reading.icon } : {}),
                entity_category: reading.key === 'daily_energy_usage' ? undefined : 'diagnostic',
            }) as ComponentInfo
            return [`pat_cloud_${reading.key}`, component]
        }),
    )

    return {
        device: {
            identifiers: identifier,
            manufacturer: 'LG',
            model,
            name: unitName,
        },
        origin: {
            name: 'rethink / LG ThinQ Connect',
            support_url: 'https://github.com/thinq-connect/pythinqconnect',
        },
        components,
    }
}

export function publishPatCloudGroup(
    publish: (property: string, value: string | number) => void,
    group: PatCloudGroup,
) {
    const prefix = topicPrefix(group.unit)
    for (const reading of group.readings) publish(`${prefix}/${reading.key}`, reading.value)
}

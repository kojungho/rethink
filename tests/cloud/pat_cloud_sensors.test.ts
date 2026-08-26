import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { patCloudDiscovery, patCloudGroups } from '@/cloud/pat_cloud_sensors'

describe('PAT-Cloud sensor mapping', () => {
    test('maps dishwasher status and calculated timers as read-only sensors', () => {
        const groups = patCloudGroups(
            'DEVICE_DISH_WASHER',
            {
                runState: { currentState: 'POWER_OFF' },
                dishWashingStatus: { rinseRefill: false },
                doorStatus: { doorState: 'CLOSE' },
                timer: { remainHour: 1, remainMinute: 5, totalHour: 2, totalMinute: 10 },
            },
            { energyUsage: 42 },
        )

        assert.equal(groups.length, 1)
        assert.equal(groups[0].readings.find((reading) => reading.key === 'remaining_time')?.value, 65)
        assert.equal(groups[0].readings.find((reading) => reading.key === 'rinse_refill')?.value, 'OFF')
        const discovery = patCloudDiscovery('식기세척기', 'H01', groups[0])
        assert.equal(discovery.components.pat_cloud_current_state.platform, 'sensor')
        assert.equal(discovery.components.pat_cloud_current_state.name, '현재 상태 (PAT-Cloud)')
        assert.equal(discovery.components.pat_cloud_daily_energy_usage.name, '오늘 전력 사용량 (PAT-Cloud)')
        assert.equal(
            (discovery.components.pat_cloud_current_state as unknown as { availability: unknown[] }).availability
                .length,
            3,
        )
    })

    test('places WashTower cloud sensors into the existing washer and dryer identifiers', () => {
        const groups = patCloudGroups(
            'DEVICE_WASHTOWER',
            {
                washer: { runState: { currentState: 'POWER_OFF' }, cycle: { cycleCount: 12 } },
                dryer: { runState: { currentState: 'POWER_OFF' } },
            },
            { energyUsage_washer: 10, energyUsage_dryer: 20 },
        )

        assert.deepEqual(
            groups.map((group) => group.unit),
            ['washer', 'dryer'],
        )
        assert.equal(patCloudDiscovery('워시타워', 'WTL', groups[0]).device.identifiers, '$deviceid-washer')
        assert.equal(patCloudDiscovery('워시타워', 'WTL', groups[1]).device.identifiers, '$deviceid-dryer')
    })

    test('maps refrigerator location values without inventing split door counters', () => {
        const groups = patCloudGroups(
            'DEVICE_REFRIGERATOR',
            {
                refrigeration: { freshAirFilter: 'AUTO' },
                doorStatus: [{ locationName: 'MAIN', doorState: 'CLOSE' }],
                temperatureInUnits: [
                    { locationName: 'FRIDGE', targetTemperatureC: 3 },
                    { locationName: 'FREEZER', targetTemperatureC: -18 },
                ],
            },
            {},
        )
        const readings = groups[0].readings

        assert.equal(readings.find((reading) => reading.key === 'door_state')?.value, 'CLOSE')
        assert.equal(readings.find((reading) => reading.key === 'fridge_temperature')?.value, 3)
        assert.equal(readings.find((reading) => reading.key === 'freezer_temperature')?.value, -18)
        assert.equal(
            readings.some((reading) => reading.key.includes('door_count')),
            false,
        )
    })
})

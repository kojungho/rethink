import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { ThinQConnectHistory, type FetchLike } from '@/cloud/thinq_connect_history'
import { MockHAConnection } from '@/tests/helpers/mocks'
import type { ThinQConnectConfig } from '@/util/config'

const DEVICE_ID = 'fridge-id'
const CONFIG: ThinQConnectConfig = {
    access_token: 'secret-token',
    country_code: 'KR',
    client_id: 'test-client',
    poll_minutes: 60,
    timezone: 'Asia/Seoul',
    refrigerator_model: '2REFO2DJC4K_U',
}

function jsonResponse(response: unknown) {
    return {
        ok: true,
        status: 200,
        async json() {
            return { response }
        },
    }
}

describe('ThinQ Connect history', () => {
    test('publishes the supported refrigerator daily energy total without exposing the PAT', async () => {
        const urls: string[] = []
        const headers: Record<string, string>[] = []
        const fetcher: FetchLike = async (url, init) => {
            urls.push(url)
            headers.push(init.headers)
            if (url.endsWith('/devices')) {
                return jsonResponse([
                    {
                        deviceId: DEVICE_ID,
                        deviceInfo: {
                            deviceType: 'DEVICE_REFRIGERATOR',
                            modelName: '2REFO2DJC4K_U',
                            alias: '냉장고',
                        },
                    },
                ])
            }
            if (url.endsWith(`/devices/energy/${DEVICE_ID}/profile`)) {
                return jsonResponse({ result: { property: ['energyUsage'] } })
            }
            if (url.endsWith(`/devices/${DEVICE_ID}/state`)) {
                return jsonResponse({ refrigeration: { freshAirFilter: 'AUTO' } })
            }
            return jsonResponse({ result: { dataList: [{ energyUsage: 2000 }, { energyUsage: 319 }] } })
        }
        const ha = new MockHAConnection()
        const history = new ThinQConnectHistory(
            ha.asConnection(),
            CONFIG,
            fetcher,
            () => new Date('2026-08-26T12:00:00+09:00'),
        ).setLocalDeviceResolver(() => 'local-fridge-id')

        await history.poll()

        assert.equal(ha.devices['local-fridge-id'].properties['pat_cloud/daily_energy_usage'], 2319)
        assert.equal(ha.devices['local-fridge-id'].properties['pat_cloud/state_availability'], 'online')
        assert.equal(ha.devices['local-fridge-id'].properties['pat_cloud/energy_availability'], 'online')
        const discovery = ha.devices['local-fridge-id-pat-cloud'].config!
        assert.equal(discovery.device.identifiers, '$deviceid')
        assert.equal(discovery.components.pat_cloud_daily_energy_usage.name, '오늘 전력 사용량 (PAT-Cloud)')
        assert.equal(discovery.components.pat_cloud_fresh_air_filter.name, '청정 탈취 필터 상태 (PAT-Cloud)')
        assert.deepEqual(ha.clearedConfigs, [`${DEVICE_ID}-thinq-history`])
        assert.match(urls[3], /period=DAILY&startDate=20260826&endDate=20260826$/)
        assert.ok(headers.every((item) => item.Authorization === 'Bearer secret-token'))
        assert.ok(urls.every((url) => !url.includes('secret-token')))
        assert.deepEqual(history.getSnapshot('local-fridge-id')?.state, {
            refrigeration: { freshAirFilter: 'AUTO' },
        })
    })

    test('does not create a guessed sensor when energyUsage is unsupported', async () => {
        const fetcher: FetchLike = async (url) => {
            if (url.endsWith('/devices')) {
                return jsonResponse([
                    {
                        deviceId: DEVICE_ID,
                        deviceInfo: {
                            deviceType: 'DEVICE_REFRIGERATOR',
                            modelName: '2REFO2DJC4K_U',
                        },
                    },
                ])
            }
            return jsonResponse({ result: { property: [] } })
        }
        const ha = new MockHAConnection()
        const history = new ThinQConnectHistory(ha.asConnection(), CONFIG, fetcher).setLocalDeviceResolver(
            () => 'local-fridge-id',
        )

        await history.poll()

        assert.equal(ha.devices['local-fridge-id-pat-cloud'], undefined)
        assert.equal(ha.devices['local-fridge-id'].properties['pat_cloud/state_availability'], 'online')
        assert.equal(ha.devices['local-fridge-id'].properties['pat_cloud/energy_availability'], 'online')
        assert.deepEqual(ha.clearedConfigs, [`${DEVICE_ID}-thinq-history`])
    })

    test('marks PAT-Cloud sensors unavailable before a refresh and keeps them offline on authentication failure', async () => {
        const fetcher: FetchLike = async () => ({
            ok: false,
            status: 401,
            async json() {
                return { error: { code: '1302', message: 'token expired' } }
            },
        })
        const ha = new MockHAConnection()
        const history = new ThinQConnectHistory(ha.asConnection(), CONFIG, fetcher)

        history.trackLocalDevice('local-fridge-id')
        await history.poll()

        assert.equal(ha.devices['local-fridge-id'].properties['pat_cloud/state_availability'], 'offline')
        assert.equal(ha.devices['local-fridge-id'].properties['pat_cloud/energy_availability'], 'offline')
    })
})

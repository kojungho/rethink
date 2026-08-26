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
            return jsonResponse({ result: { dataList: [{ energyUsage: 2000 }, { energyUsage: 319 }] } })
        }
        const ha = new MockHAConnection()
        const history = new ThinQConnectHistory(
            ha.asConnection(),
            CONFIG,
            fetcher,
            () => new Date('2026-08-26T12:00:00+09:00'),
        )

        await history.poll()

        assert.equal(ha.devices[DEVICE_ID].properties.thinq_daily_energy_usage, 2319)
        assert.equal(ha.devices[DEVICE_ID].properties.thinq_history_availability, 'online')
        const discovery = ha.devices[`${DEVICE_ID}-thinq-history`].config!
        assert.equal(discovery.components.thinq_daily_energy_usage.name, '오늘 전력 사용량')
        assert.match(urls[2], /period=DAILY&startDate=20260826&endDate=20260826$/)
        assert.ok(headers.every((item) => item.Authorization === 'Bearer secret-token'))
        assert.ok(urls.every((url) => !url.includes('secret-token')))
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
        const history = new ThinQConnectHistory(ha.asConnection(), CONFIG, fetcher)

        await history.poll()

        assert.equal(ha.devices[`${DEVICE_ID}-thinq-history`], undefined)
        assert.equal(ha.devices[DEVICE_ID].properties.thinq_history_availability, 'offline')
    })
})

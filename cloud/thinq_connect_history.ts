import { randomBytes } from 'node:crypto'
import type { ThinQConnectConfig } from '@/util/config'
import type { Connection, DeviceDiscovery } from './homeassistant'
import { allowExtendedType } from '@/util/casting'
import log from '@/util/logging'

const API_KEY = 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3'

type JsonResponse = {
    ok: boolean
    status: number
    json(): Promise<unknown>
}

export type FetchLike = (
    url: string,
    init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<JsonResponse>

type ThinQDevice = {
    deviceId?: string
    deviceInfo?: {
        deviceType?: string
        modelName?: string
        alias?: string
    }
}

function responseBody(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') return payload
    return (payload as { response?: unknown }).response ?? payload
}

function compactDate(now: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now)
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    return `${get('year')}${get('month')}${get('day')}`
}

export class ThinQConnectHistory {
    private timer?: NodeJS.Timeout
    private pollPromise?: Promise<void>
    private refrigeratorId?: string
    private discoveryConfig?: DeviceDiscovery

    constructor(
        private readonly HA: Connection,
        private readonly config: ThinQConnectConfig,
        private readonly fetcher: FetchLike = fetch as FetchLike,
        private readonly now: () => Date = () => new Date(),
    ) {
        HA.on('discovery', () => this.publishDiscovery())
        HA.on('statusChanged', (online) => {
            if (online) void this.poll()
        })
    }

    start() {
        if (!this.config.access_token) return
        if (this.HA.isConnected) void this.poll()
        const interval = Math.max(15, this.config.poll_minutes) * 60_000
        this.timer = setInterval(() => void this.poll(), interval)
        this.timer.unref()
    }

    stop() {
        if (this.timer) clearInterval(this.timer)
        this.timer = undefined
    }

    poll(): Promise<void> {
        if (!this.pollPromise) {
            this.pollPromise = this.pollOnce().finally(() => {
                this.pollPromise = undefined
            })
        }
        return this.pollPromise
    }

    private async pollOnce() {
        try {
            const devices = (await this.request('devices')) as ThinQDevice[]
            const refrigerator = devices.find(
                (device) =>
                    device.deviceInfo?.deviceType === 'DEVICE_REFRIGERATOR' &&
                    device.deviceInfo.modelName === this.config.refrigerator_model,
            )
            if (!refrigerator?.deviceId) {
                throw new Error(`refrigerator model ${this.config.refrigerator_model} was not returned`)
            }

            this.refrigeratorId = refrigerator.deviceId
            const energyProfile = (await this.request(`devices/energy/${refrigerator.deviceId}/profile`)) as {
                result?: { property?: string[] }
            }
            const properties = energyProfile.result?.property ?? []
            if (!properties.includes('energyUsage')) {
                throw new Error('daily energy usage is not supported by this refrigerator')
            }

            this.discoveryConfig = this.makeDiscovery(refrigerator)
            this.publishDiscovery()

            const date = compactDate(this.now(), this.config.timezone)
            const usage = (await this.request(
                `devices/energy/${refrigerator.deviceId}/usage?property=energyUsage&period=DAILY&startDate=${date}&endDate=${date}`,
            )) as { result?: { dataList?: Array<Record<string, unknown>> } }
            const wattHours = (usage.result?.dataList ?? []).reduce((total, item) => {
                const value = Number(item.energyUsage)
                return Number.isFinite(value) ? total + value : total
            }, 0)

            this.HA.publishProperty(refrigerator.deviceId, 'thinq_daily_energy_usage', wattHours)
            this.HA.publishProperty(refrigerator.deviceId, 'thinq_history_availability', 'online')
            log('status', `ThinQ Connect refrigerator daily energy updated (${wattHours} Wh)`)
        } catch (err) {
            if (this.refrigeratorId) {
                this.HA.publishProperty(this.refrigeratorId, 'thinq_history_availability', 'offline')
            }
            console.warn(`ThinQ Connect history update failed: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    private publishDiscovery() {
        if (!this.refrigeratorId || !this.discoveryConfig) return
        this.HA.publishConfig(this.refrigeratorId, this.discoveryConfig, `${this.refrigeratorId}-thinq-history`)
    }

    private makeDiscovery(device: ThinQDevice): DeviceDiscovery {
        return allowExtendedType({
            availability: [{ topic: '$this/thinq_history_availability' }, { topic: '$rethink/availability' }],
            availability_mode: 'all',
            device: {
                identifiers: '$deviceid',
                manufacturer: 'LG',
                model: device.deviceInfo?.modelName,
                name: device.deviceInfo?.alias ?? '냉장고',
            },
            origin: {
                name: 'rethink / LG ThinQ Connect',
                support_url: 'https://github.com/thinq-connect/pythinqconnect',
            },
            components: {
                thinq_daily_energy_usage: {
                    platform: 'sensor',
                    device_class: 'energy',
                    state_class: 'total',
                    unit_of_measurement: 'Wh',
                    icon: 'mdi:lightning-bolt',
                    name: '오늘 전력 사용량',
                    unique_id: '$deviceid-thinq_daily_energy_usage',
                    state_topic: '$this/thinq_daily_energy_usage',
                } as unknown as DeviceDiscovery['components'][string],
            },
        })
    }

    private async request(path: string): Promise<unknown> {
        const region = this.config.country_code.toUpperCase() === 'KR' ? 'kic' : 'aic'
        const response = await this.fetcher(`https://api-${region}.lgthinq.com/${path}`, {
            headers: {
                Authorization: `Bearer ${this.config.access_token}`,
                'x-country': this.config.country_code,
                'x-message-id': randomBytes(16).toString('base64url'),
                'x-client-id': this.config.client_id,
                'x-api-key': API_KEY,
                'x-service-phase': 'OP',
            },
            signal: AbortSignal.timeout(15_000),
        })
        const payload = await response.json()
        if (!response.ok) {
            const message = JSON.stringify(payload)
            throw new Error(`HTTP ${response.status}: ${message.slice(0, 300)}`)
        }
        return responseBody(payload)
    }
}

export { compactDate, responseBody }

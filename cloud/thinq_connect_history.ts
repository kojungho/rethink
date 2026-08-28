import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ThinQConnectConfig } from '@/util/config'
import type { Connection, DeviceDiscovery } from './homeassistant'
import log from '@/util/logging'
import { patCloudDiscovery, patCloudGroups, publishPatCloudGroup } from './pat_cloud_sensors'

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

export type ThinQConnectSnapshot = {
    alias: string
    model: string
    deviceType: string
    updatedAt: string
    state?: unknown
    energyProperties: string[]
    dailyEnergy: Record<string, number>
    error?: string
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

export class ThinQConnectHistory extends EventEmitter {
    private timer?: NodeJS.Timeout
    private refreshTimer?: NodeJS.Timeout
    private pollPromise?: Promise<void>
    private resolveLocalDeviceId: (model: string) => string | undefined = () => undefined
    private resolveLocalComponents: (localDeviceId: string) => ReadonlySet<string> = () => new Set()
    private readonly snapshots = new Map<string, ThinQConnectSnapshot>()
    private readonly trackedLocalDeviceIds = new Set<string>()

    constructor(
        private readonly HA: Connection,
        private readonly config: ThinQConnectConfig,
        private readonly fetcher: FetchLike = fetch as FetchLike,
        private readonly now: () => Date = () => new Date(),
    ) {
        super()
        HA.on('statusChanged', (online) => {
            if (online) {
                this.markTrackedUnavailable()
                void this.poll()
            }
        })
    }

    setLocalDeviceResolver(resolver: (model: string) => string | undefined) {
        this.resolveLocalDeviceId = resolver
        return this
    }

    setLocalComponentsResolver(resolver: (localDeviceId: string) => ReadonlySet<string>) {
        this.resolveLocalComponents = resolver
        return this
    }

    getSnapshot(localDeviceId: string) {
        return this.snapshots.get(localDeviceId)
    }

    trackLocalDevice(localDeviceId: string) {
        this.trackedLocalDeviceIds.add(localDeviceId)
        this.markUnavailable(localDeviceId)
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
        if (this.refreshTimer) clearTimeout(this.refreshTimer)
        this.timer = undefined
        this.refreshTimer = undefined
    }

    schedulePoll(delayMs = 3_000) {
        if (this.refreshTimer) clearTimeout(this.refreshTimer)
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined
            void this.poll()
        }, delayMs)
        this.refreshTimer.unref()
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
        this.markTrackedUnavailable()
        try {
            const devices = (await this.request('devices')) as ThinQDevice[]
            for (const device of devices) await this.updateDevice(device)
            log('status', `ThinQ Connect PAT snapshots updated (${this.snapshots.size} local devices)`)
        } catch (err) {
            console.warn(`ThinQ Connect history update failed: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    private async updateDevice(device: ThinQDevice) {
        const cloudDeviceId = device.deviceId
        const model = device.deviceInfo?.modelName
        if (!cloudDeviceId || !model) return

        // 0.1.90 briefly used the ThinQ cloud ID as a separate HA device.
        // The PAT sensors now share the local device identifier instead.
        if (model === this.config.refrigerator_model) {
            this.HA.clearConfig(cloudDeviceId, `${cloudDeviceId}-thinq-history`)
        }

        const localDeviceId = this.resolveLocalDeviceId(model)
        if (!localDeviceId) return
        this.trackedLocalDeviceIds.add(localDeviceId)

        const snapshot: ThinQConnectSnapshot = {
            alias: device.deviceInfo?.alias ?? model,
            model,
            deviceType: device.deviceInfo?.deviceType ?? 'UNKNOWN',
            updatedAt: this.now().toISOString(),
            energyProperties: [],
            dailyEnergy: {},
        }

        const errors: string[] = []
        let stateAvailable = false
        try {
            snapshot.state = await this.request(`devices/${cloudDeviceId}/state`)
            stateAvailable = true
        } catch (err) {
            errors.push(`state: ${this.errorMessage(err)}`)
        }

        let energyAvailable = false
        try {
            const energyProfile = (await this.request(`devices/energy/${cloudDeviceId}/profile`)) as {
                result?: { property?: string[] }
            }
            snapshot.energyProperties = energyProfile.result?.property ?? []
            const date = compactDate(this.now(), this.config.timezone)
            for (const property of snapshot.energyProperties) {
                const usage = (await this.request(
                    `devices/energy/${cloudDeviceId}/usage?property=${encodeURIComponent(property)}&period=DAILY&startDate=${date}&endDate=${date}`,
                )) as { result?: { dataList?: Array<Record<string, unknown>> } }
                snapshot.dailyEnergy[property] = (usage.result?.dataList ?? []).reduce((total, item) => {
                    const value = Number(item[property])
                    return Number.isFinite(value) ? total + value : total
                }, 0)
            }
            energyAvailable = true
        } catch (err) {
            // Error 1221 is the documented response for products without an
            // energy profile. Keep their live PAT state visible without marking
            // the whole snapshot as failed.
            if (!this.errorMessage(err).includes('1221')) errors.push(`energy: ${this.errorMessage(err)}`)
        }

        if (errors.length) snapshot.error = errors.join('; ')
        this.snapshots.set(localDeviceId, snapshot)
        this.emit('snapshot', localDeviceId, snapshot)

        const allGroups = patCloudGroups(snapshot.deviceType, snapshot.state, snapshot.dailyEnergy)
        const localComponents = this.resolveLocalComponents(localDeviceId)
        const groups = patCloudGroups(snapshot.deviceType, snapshot.state, snapshot.dailyEnergy, localComponents)
        const groupsByUnit = new Map(groups.map((group) => [group.unit, group]))
        for (const allGroup of allGroups) {
            const group = groupsByUnit.get(allGroup.unit)
            const suffix = allGroup.unit === 'main' ? '' : `-${allGroup.unit}`
            const discoveryId = `${localDeviceId}-pat-cloud${suffix}`
            if (!group) {
                this.HA.clearConfig(localDeviceId, discoveryId)
                continue
            }
            const keptKeys = new Set(group.readings.map((reading) => reading.key))
            const removedReadings = allGroup.readings.filter((reading) => !keptKeys.has(reading.key))
            if (removedReadings.length) {
                const cleanup = patCloudDiscovery(snapshot.alias, snapshot.model, group)
                for (const reading of removedReadings) {
                    cleanup.components[`pat_cloud_${reading.key}`] = {
                        platform: 'sensor',
                    } as DeviceDiscovery['components'][string]
                }
                this.HA.publishConfig(localDeviceId, cleanup, discoveryId)
            }
            this.HA.publishConfig(localDeviceId, patCloudDiscovery(snapshot.alias, snapshot.model, group), discoveryId)
            publishPatCloudGroup((property, value) => this.HA.publishProperty(localDeviceId, property, value), group)
        }
        this.HA.publishProperty(localDeviceId, 'pat_cloud/state_availability', stateAvailable ? 'online' : 'offline')
        this.HA.publishProperty(localDeviceId, 'pat_cloud/energy_availability', energyAvailable ? 'online' : 'offline')
    }

    private markUnavailable(localDeviceId: string) {
        this.HA.publishProperty(localDeviceId, 'pat_cloud/state_availability', 'offline')
        this.HA.publishProperty(localDeviceId, 'pat_cloud/energy_availability', 'offline')
    }

    private markTrackedUnavailable() {
        for (const localDeviceId of this.trackedLocalDeviceIds) this.markUnavailable(localDeviceId)
    }

    private errorMessage(err: unknown) {
        return err instanceof Error ? err.message : String(err)
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

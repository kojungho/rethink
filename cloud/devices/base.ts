import { type Metadata } from '../thinq'
import type { Connection, DeviceDiscovery } from '../homeassistant'

export default class HADevice {
    config: DeviceDiscovery | undefined
    private removedComponents: Record<string, { platform: string }> = {}

    static config(meta: Metadata, deviceInfo?: object): DeviceDiscovery {
        return {
            availability: [{ topic: '$this/availability' }, { topic: '$rethink/availability' }],
            availability_mode: 'all',
            device: {
                identifiers: '$deviceid',
                manufacturer: 'LG',
                model: meta.modelName,
                sw_version: meta.swVersion,
                ...(deviceInfo || {}),
            },
            origin: {
                name: 'rethink',
                support_url: 'https://github.com/anszom/rethink',
            },
            components: {},
        }
    }

    constructor(
        readonly HA: Connection,
        readonly id: string,
    ) {}

    setConfig(config: DeviceDiscovery, removedComponents?: Record<string, { platform: string }>) {
        this.config = config
        this.removedComponents = removedComponents ?? {}
        this.publishConfig()
    }

    drop() {
        this.HA.publishProperty(this.id, 'availability', 'offline')
    }

    start() {}

    // HA-side
    publishConfig() {
        if (this.config) {
            this.HA.publishProperty(this.id, 'availability', 'online')
            if (Object.keys(this.removedComponents).length) {
                // MQTT device discovery removes one component when an update contains
                // only its platform. Follow with the normal config, where it is omitted.
                this.HA.publishConfig(this.id, {
                    ...this.config,
                    components: { ...this.config.components, ...this.removedComponents },
                } as DeviceDiscovery)
            }
            this.HA.publishConfig(this.id, this.config)
        }
    }

    setProperty(prop: string, mqttValue: string) {
        throw new Error('To be overriden')
    }
}

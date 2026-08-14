import RACDevice from './RAC_056905_WW'
import { Device as Thinq2Device } from '../thinq2/device'
import { DeviceDiscovery, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import * as TLV from '@/util/tlv'

const fields = { power: 0x1f7, mode: 0x1f9, fanSpeed: 0x1fa, currentTemperature: 0x1fd, targetTemperature: 0x1fe } as const

/** LG Korean stand air conditioner using A7 TLV notifications and A8 fixed status frames. */
export default class Device extends RACDevice {
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
        this.raw_clip_state[0x2b3] = 60
        this.initialValuesReceived = true
        this.initMakeSetConfig()
    }

    start() {}
    query() {}

    protected extendConfig(config: DeviceDiscovery) {
        const sensors = {
            humidity: { name: '현재 습도', device_class: 'humidity', unit_of_measurement: '%', icon: 'mdi:water-percent' },
            pm2_5: { name: 'PM2.5', device_class: 'pm25', unit_of_measurement: 'μg/m³', icon: 'mdi:molecule' },
            pm10: { name: 'PM10', device_class: 'pm10', unit_of_measurement: 'μg/m³', icon: 'mdi:molecule' },
            filter_remaining: { name: '필터 잔여량', unit_of_measurement: '%', icon: 'mdi:air-filter' },
        } as const
        for (const [id, sensor] of Object.entries(sensors)) {
            config.components[id] = {
                platform: 'sensor', unique_id: `$deviceid-${id}`, state_topic: `$this/${id}`,
                state_class: 'measurement', entity_category: id === 'filter_remaining' ? 'diagnostic' : undefined, ...sensor,
            }
        }
    }

    processData(buf: Buffer) {
        if (buf.length >= 13 && buf[0] === 0 && buf[1] === 0 && buf[2] === 4 && buf[6] === 0xa7 &&
            buf[7] === 2 && buf[8] === 4 && buf[10] === buf.length - 13) {
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
        this.HA.publishProperty(this.id, 'pm10', buf[59])
        this.HA.publishProperty(this.id, 'humidity', buf[60])
        this.HA.publishProperty(this.id, 'filter_remaining', buf[286])
    }

    processKeyValue(id: number, value: number) {
        if (id === fields.mode && value === 5) {
            this.raw_clip_state[id] = value
            this.HA.publishProperty(this.id, 'climate-mode', 'fan_only')
            this.HA.publishProperty(this.id, 'climate-preset_mode', '공기 청정')
            return
        }
        super.processKeyValue(id, value)
    }

    setProperty(prop: string, value: string) {
        if (prop === 'climate-preset_mode' && value === '공기 청정') {
            this.raw_clip_state[fields.mode] = 5
            this.send([1, 1, 2, 1, 1], [{ t: fields.mode, v: 5 }])
            return
        }
        if (prop === 'climate-mode' && value === 'fan_only') {
            this.raw_clip_state[fields.mode] = 5
            this.send([1, 1, 2, 1, 1], [
                { t: fields.mode, v: 5 }, { t: fields.fanSpeed, v: this.raw_clip_state[fields.fanSpeed] },
                { t: fields.targetTemperature, v: this.raw_clip_state[fields.targetTemperature] },
            ])
            return
        }
        super.setProperty(prop, value)
    }
}

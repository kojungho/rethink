import HADevice from './base'
import AABBDevice from './aabb_device'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'

const STATUS_LENGTH = 26

/**
 * Preliminary support for the Korean H01 dishwasher (ThinQ device type 204).
 *
 * The appliance uses the common AA...BB envelope and responds to the standard
 * full-state query with 0x32eb + a 26-byte status block. The individual status
 * bytes are not labelled until captures from known operating states are
 * available, so expose the block only as a diagnostic value rather than
 * publishing guessed cycle or control entities.
 */
export default class Device extends AABBDevice {
    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Dishwasher' }),
                components: {
                    protocol_status: {
                        platform: 'sensor',
                        unique_id: '$deviceid-protocol-status',
                        state_topic: '$this/protocol_status',
                        name: 'Protocol status',
                        icon: 'mdi:dishwasher',
                        entity_category: 'diagnostic',
                    },
                },
            }),
        )
    }

    start() {
        this.send(Buffer.from('F0ED1211010000010400', 'hex'))
    }

    processAABB(buf: Buffer) {
        if (buf.length === 2 + STATUS_LENGTH && buf[0] === 0x32 && buf[1] === 0xeb) {
            this.publishStatus(buf.subarray(2))
        } else if (buf.length === 2 + STATUS_LENGTH * 2 && buf[0] === 0x32 && buf[1] === 0xec) {
            this.publishStatus(buf.subarray(2 + STATUS_LENGTH))
        }
    }

    private publishStatus(status: Buffer) {
        this.publishProperty('protocol_status', status.toString('hex').toUpperCase())
    }

    setProperty(prop: string) {
        console.warn(`H01 is read-only; ignoring property ${prop}`)
    }
}

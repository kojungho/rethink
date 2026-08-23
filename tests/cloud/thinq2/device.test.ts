import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { Device, DeviceAcceptor, timeSyncPayload } from '@/cloud/thinq2/device'
import { EventEmitter } from 'node:events'
import type { Broker } from '@/cloud/mqtt-broker'

describe('ThinQ2 time synchronization', () => {
    test('encodes a one-based month in the appliance timezone', () => {
        const result = timeSyncPayload(new Date('2026-08-14T23:59:58Z'), '+0900')
        assert.deepEqual([...result], [26, 8, 15, 8, 59, 58, 6])
    })
})

test('emits every raw appliance packet before model decoding', () => {
    const broker = new EventEmitter() as unknown as Broker
    const acceptor = new DeviceAcceptor(broker)
    const device = new Device(broker, 'lime/device-1', 'device-1', { modelId: 'unknown' })
    const client = { deployMsg: { did: 'device-1' }, deviceObj: device }
    const packet = Buffer.from('AA07F0261688BB', 'hex')
    let raw: Buffer | undefined

    device.on('rawData', (value) => (raw = value))
    device.on('data', () => {
        throw new Error('unsupported model packet')
    })

    assert.throws(
        () =>
            acceptor.mqtt(
                'clip/message/devices/device-1',
                { did: 'device-1', cmd: 'device_packet', type: 1, data: packet.toString('hex'), mid: 1 },
                client as never,
            ),
        /unsupported model packet/,
    )
    assert.deepEqual(raw, packet)
})

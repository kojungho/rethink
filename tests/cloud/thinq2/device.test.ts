import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { Device, DeviceAcceptor, timeSyncPayload } from '@/cloud/thinq2/device'
import { EventEmitter } from 'node:events'
import type { Broker } from '@/cloud/mqtt-broker'

describe('ThinQ2 time synchronization', () => {
    test('encodes the ThinQ zero-based month in UTC', () => {
        const result = timeSyncPayload(new Date('2026-08-14T23:59:58Z'), '+0900')
        assert.deepEqual([...result], [26, 7, 14, 23, 59, 58, 5])
    })

    test('does not send unsolicited time synchronization when PAC completes provisioning', () => {
        const published: Array<{ topic: string; payload: Buffer | string }> = []
        const broker = Object.assign(new EventEmitter(), {
            publish(packet: { topic: string; payload: Buffer | string }) {
                published.push(packet)
            },
        }) as unknown as Broker
        const acceptor = new DeviceAcceptor(broker)
        const client = {
            deployMsg: {
                did: 'pac-1',
                kind: 'PAC_910604_WW',
                data: { appInfo: { timezone: '+0900' } },
            },
            deviceObj: undefined,
            destroy() {},
        }

        acceptor.completeProvisioning(
            'pac-1',
            { did: 'pac-1', cmd: 'completeProvisioning_ack', type: 1, data: '', mid: 1 },
            client as never,
        )

        assert.equal(published.length, 0)
    })

    test('does not send unsolicited time synchronization to other models', () => {
        const published: unknown[] = []
        const broker = Object.assign(new EventEmitter(), {
            publish(packet: unknown) {
                published.push(packet)
            },
        }) as unknown as Broker
        const acceptor = new DeviceAcceptor(broker)
        const client = {
            deployMsg: { did: 'other-1', kind: 'OTHER_MODEL', data: { appInfo: { timezone: '+0900' } } },
            deviceObj: undefined,
            destroy() {},
        }

        acceptor.completeProvisioning(
            'other-1',
            { did: 'other-1', cmd: 'completeProvisioning_ack', type: 1, data: '', mid: 1 },
            client as never,
        )

        assert.equal(published.length, 0)
    })

    test('sends time synchronization only in response to a PAC request', () => {
        const published: Array<{ topic: string; payload: Buffer | string }> = []
        const broker = Object.assign(new EventEmitter(), {
            publish(packet: { topic: string; payload: Buffer | string }) {
                published.push(packet)
            },
        }) as unknown as Broker
        const acceptor = new DeviceAcceptor(broker)
        const client = {
            deployMsg: {
                did: 'pac-1',
                kind: 'PAC_910604_WW',
                data: { appInfo: { timezone: '+0900' } },
            },
            deviceObj: undefined,
        }
        const packet = {
            did: 'pac-1',
            kind: 'PAC_910604_WW',
            cmd: 'req_timesync',
            type: 1,
            data: null,
            mid: 1,
        } as const

        acceptor.mqtt('clip/message/devices/pac-1', packet, client as never)

        assert.equal(published.length, 1)
        const response = JSON.parse(published[0].payload.toString())
        assert.equal(response.cmd, 'resp_timesync')
        assert.equal(Buffer.from(response.data, 'base64').length, 7)
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

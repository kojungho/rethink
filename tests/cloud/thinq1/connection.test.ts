import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { createServer, connect, type Server } from 'node:net'
import { after, before, test } from 'node:test'
import { Connection } from '@/cloud/thinq1/connection'
import { Device } from '@/cloud/thinq1/device'
import type { Metadata } from '@/cloud/thinq'
import { make } from '@/util/length_prefixed_frame'

let server: Server
let port: number
const connectionErrors: Error[] = []

before(async () => {
    server = createServer((socket) => {
        const connection = new Connection(socket)
        connection.on('error', (error) => connectionErrors.push(error))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    port = address.port
})

after(async () => {
    server.close()
    await once(server, 'close')
})

async function sendMalformed(payload: Buffer) {
    const client = connect(port, '127.0.0.1')
    await once(client, 'connect')
    client.write(payload)
    await once(client, 'close')
}

test('malformed length-prefixed input closes only its real socket', async () => {
    await sendMalformed(Buffer.from([0xff, 0xff, 0xff, 0xff]))
    assert.match(connectionErrors.at(-1)?.message ?? '', /negative/)

    const nextClient = connect(port, '127.0.0.1')
    await once(nextClient, 'connect')
    const closed = once(nextClient, 'close')
    nextClient.write(
        make(
            JSON.stringify({
                Header: { 'x-lgedm-deviceId': '48552db0-1ab4-11e9-b4fb-7c1c4ec8cc53' },
                Body: { ReturnCode: '0000' },
            }),
        ),
    )
    nextClient.destroy()
    await closed
})

test('oversized and truncated real socket frames are contained', async () => {
    await sendMalformed(Buffer.from([0x00, 0x01, 0x00, 0x01]))
    assert.match(connectionErrors.at(-1)?.message ?? '', /exceeded/)

    const client = connect(port, '127.0.0.1')
    await once(client, 'connect')
    client.write(Buffer.from([0x00, 0x00, 0x00, 0x05, 0x01]))
    client.end()
    await once(client, 'close')
    assert.match(connectionErrors.at(-1)?.message ?? '', /Truncated/)
})

test('emits every raw appliance packet before model decoding', () => {
    const connection = new EventEmitter() as unknown as Connection
    const device = new Device(connection, 'device-1', { modelId: 'unknown' } as Metadata)
    const packet = Buffer.from('01020304', 'hex')
    let raw: Buffer | undefined

    device.on('rawData', (value) => (raw = value))
    device.on('data', () => {
        throw new Error('unsupported model packet')
    })

    assert.throws(() => connection.emit('status', packet), /unsupported model packet/)
    assert.deepEqual(raw, packet)
})

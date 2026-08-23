import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'
import type HA_bridge from '@/cloud/ha_bridge'
import { DeviceManager } from '@/cloud/devmgr'
import { app } from '@/management'
import { MockThinq1Device, MockThinq2Device } from '../helpers/mocks'

function nextJson(ws: WebSocket, predicate: (message: any) => boolean) {
    return new Promise<any>((resolve) => {
        const listener = (data: WebSocket.RawData) => {
            const message = JSON.parse(data.toString())
            if (!predicate(message)) return
            ws.off('message', listener)
            resolve(message)
        }
        ws.on('message', listener)
    })
}

test('device monitor detaches device and manager listeners after a real WebSocket close', async () => {
    const haStatus = Object.assign(new EventEmitter(), { isConnected: true })
    const ha = { HA: haStatus, haDevices: new Map() } as unknown as HA_bridge
    const manager = new DeviceManager()
    const device = new MockThinq1Device('device-1', {
        modelId: 'model-id',
        modelName: 'model-name',
        deviceType: '401',
    })
    manager.accept(device)

    const server = app(ha, manager, undefined)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as AddressInfo).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/device?id=device-1`)
    const firstMessage = once(ws, 'message')
    await once(ws, 'open')
    await firstMessage

    assert.equal(device.listenerCount('data'), 1)
    assert.equal(device.listenerCount('sendData'), 1)
    assert.equal(manager.listenerCount('newDevice'), 2)
    assert.equal(manager.listenerCount('dropDevice'), 2)

    ws.close()
    await once(ws, 'close')

    assert.equal(device.listenerCount('data'), 0)
    assert.equal(device.listenerCount('sendData'), 0)
    assert.equal(manager.listenerCount('newDevice'), 1)
    assert.equal(manager.listenerCount('dropDevice'), 1)

    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
    })
    assert.equal(manager.listenerCount('newDevice'), 0)
    assert.equal(manager.listenerCount('dropDevice'), 0)
    assert.equal(haStatus.listenerCount('statusChanged'), 0)
})

test('server shutdown closes a connected device monitor and detaches all listeners', async () => {
    const haStatus = Object.assign(new EventEmitter(), { isConnected: true })
    const ha = { HA: haStatus, haDevices: new Map() } as unknown as HA_bridge
    const manager = new DeviceManager()
    const device = new MockThinq1Device('device-1', {
        modelId: 'model-id',
        modelName: 'model-name',
        deviceType: '401',
    })
    manager.accept(device)

    const server = app(ha, manager, undefined)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as AddressInfo).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/device?id=device-1`)
    const firstMessage = once(ws, 'message')
    await once(ws, 'open')
    await firstMessage

    const websocketClosed = once(ws, 'close')
    const serverClosed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
    })
    await Promise.all([websocketClosed, serverClosed])

    assert.equal(device.listenerCount('data'), 0)
    assert.equal(device.listenerCount('sendData'), 0)
    assert.equal(manager.listenerCount('newDevice'), 0)
    assert.equal(manager.listenerCount('dropDevice'), 0)
    assert.equal(haStatus.listenerCount('statusChanged'), 0)
})

test('device monitor records, annotates, lists, and downloads a capture', async () => {
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rethink-management-capture-'))
    const haStatus = Object.assign(new EventEmitter(), { isConnected: true })
    const ha = { HA: haStatus, haDevices: new Map() } as unknown as HA_bridge
    const manager = new DeviceManager()
    const device = new MockThinq2Device('device-1', {
        modelId: 'H01',
        modelName: 'H01',
        deviceType: '204',
    })
    manager.accept(device)

    const server = app(ha, manager, undefined, captureDir)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as AddressInfo).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/device?id=device-1`)

    try {
        await once(ws, 'open')
        const started = nextJson(ws, (message) => message.capture?.active === true && message.capture?.filename)
        ws.send(JSON.stringify({ captureStart: true }))
        const filename = (await started).capture.filename

        device.emit('data', Buffer.from('AA2032EB001800000001270000000100000200000042804100000000000365BB', 'hex'))
        device.send_packet(Buffer.from('AA07F0261688BB', 'hex'))
        ws.send(JSON.stringify({ captureNote: 'Power button pressed' }))

        const stopped = nextJson(ws, (message) => message.capture?.active === false)
        ws.send(JSON.stringify({ captureStop: true }))
        await stopped

        const events = fs
            .readFileSync(path.join(captureDir, filename), 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        assert.equal(
            events.some((event) => event.k === 'wire' && event.dir === 'fromDevice'),
            true,
        )
        assert.equal(
            events.some((event) => event.k === 'wire' && event.dir === 'toDevice'),
            true,
        )
        assert.equal(
            events.some((event) => event.k === 'note' && event.text === 'Power button pressed'),
            true,
        )

        const listResponse = await fetch(`http://127.0.0.1:${port}/captures?id=device-1`)
        const list = await listResponse.json()
        assert.equal(list.captures[0].filename, filename)
        const downloadResponse = await fetch(`http://127.0.0.1:${port}/capture/${filename}`)
        assert.equal(downloadResponse.status, 200)
        assert.match(await downloadResponse.text(), /"k":"session"/)
    } finally {
        ws.close()
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
        fs.rmSync(captureDir, { recursive: true, force: true })
    }
})

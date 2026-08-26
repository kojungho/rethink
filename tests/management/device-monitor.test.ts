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
import type { ThinQConnectHistory, ThinQConnectSnapshot } from '@/cloud/thinq_connect_history'

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
    const status = JSON.parse((await firstMessage)[0].toString())

    assert.equal(status.name, 'model-name')

    assert.equal(device.listenerCount('packetData'), 1)
    assert.equal(device.listenerCount('sendData'), 1)
    assert.equal(manager.listenerCount('newDevice'), 2)
    assert.equal(manager.listenerCount('dropDevice'), 2)

    ws.close()
    await once(ws, 'close')

    assert.equal(device.listenerCount('packetData'), 0)
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

    assert.equal(device.listenerCount('packetData'), 0)
    assert.equal(device.listenerCount('sendData'), 0)
    assert.equal(manager.listenerCount('newDevice'), 0)
    assert.equal(manager.listenerCount('dropDevice'), 0)
    assert.equal(haStatus.listenerCount('statusChanged'), 0)
})

test('device monitor sends the current and updated ThinQ Connect PAT snapshot', async () => {
    const haStatus = Object.assign(new EventEmitter(), { isConnected: true })
    const ha = { HA: haStatus, haDevices: new Map() } as unknown as HA_bridge
    const manager = new DeviceManager()
    const device = new MockThinq1Device('device-1', {
        modelId: 'model-id',
        modelName: 'model-name',
        deviceType: '401',
    })
    manager.accept(device)

    let snapshot: ThinQConnectSnapshot = {
        alias: '거실 에어컨',
        model: 'model-id',
        deviceType: 'DEVICE_AIR_CONDITIONER',
        updatedAt: '2026-08-27T00:00:00.000Z',
        state: { temperature: { currentTemperature: 27 } },
        energyProperties: ['energyUsage'],
        dailyEnergy: { energyUsage: 123 },
    }
    const cloudEmitter = new EventEmitter()
    const cloud = Object.assign(cloudEmitter, {
        getSnapshot(id: string) {
            return id === 'device-1' ? snapshot : undefined
        },
    }) as unknown as ThinQConnectHistory

    const server = app(ha, manager, undefined, undefined, cloud)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as AddressInfo).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/device?id=device-1`)

    try {
        const initial = nextJson(ws, (message) => message.cloud?.dailyEnergy?.energyUsage === 123)
        await once(ws, 'open')
        assert.equal((await initial).cloud.state.temperature.currentTemperature, 27)

        snapshot = { ...snapshot, dailyEnergy: { energyUsage: 456 } }
        const updated = nextJson(ws, (message) => message.cloud?.dailyEnergy?.energyUsage === 456)
        cloud.emit('snapshot', 'device-1', snapshot)
        assert.equal((await updated).cloud.dailyEnergy.energyUsage, 456)
    } finally {
        ws.close()
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }

    assert.equal(cloud.listenerCount('snapshot'), 0)
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

        const inbound = Buffer.from('AA2032EB001800000001270000000100000200000042804100000000000365BB', 'hex')
        const firstRx = nextJson(ws, (message) => message.rx === inbound.toString('hex'))
        device.emit('packetData', inbound, true)
        device.emit('packetData', inbound, false)
        await firstRx
        const outbound = Buffer.from('AA07F0261688BB', 'hex')
        const normalTx = nextJson(ws, (message) => message.tx === outbound.toString('hex'))
        device.send_packet(outbound)
        assert.equal((await normalTx).mapped, true)

        const injectedTx = nextJson(ws, (message) => message.tx === outbound.toString('hex') && message.injected)
        ws.send(JSON.stringify({ sendToDevice: outbound.toString('hex') }))
        assert.equal((await injectedTx).mapped, false)
        ws.send(JSON.stringify({ captureNote: 'Power button pressed' }))

        const stopped = nextJson(ws, (message) => message.capture?.active === false)
        ws.send(JSON.stringify({ captureStop: true }))
        const finalFilename = (await stopped).capture.filename

        assert.match(finalFilename, /^capture-device-1-\d{8}T\d{9}Z-Power-button-pressed\.jsonl$/)
        assert.equal(fs.existsSync(path.join(captureDir, filename)), false)

        const events = fs
            .readFileSync(path.join(captureDir, finalFilename), 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        assert.equal(events.filter((event) => event.k === 'wire' && event.dir === 'fromDevice').length, 2)
        assert.deepEqual(
            events.filter((event) => event.k === 'wire' && event.dir === 'fromDevice').map((event) => event.mapped),
            [true, false],
        )
        assert.deepEqual(
            events.filter((event) => event.k === 'wire' && event.dir === 'toDevice').map((event) => event.mapped),
            [true, false],
        )
        assert.equal(
            events.some((event) => event.k === 'note' && event.text === 'Power button pressed'),
            true,
        )

        const listResponse = await fetch(`http://127.0.0.1:${port}/captures?id=device-1`)
        const list = await listResponse.json()
        assert.equal(list.captures[0].filename, finalFilename)
        const downloadResponse = await fetch(`http://127.0.0.1:${port}/capture/${finalFilename}`)
        assert.equal(downloadResponse.status, 200)
        assert.match(await downloadResponse.text(), /"k":"session"/)

        const deleteResponse = await fetch(`http://127.0.0.1:${port}/capture/${finalFilename}`, {
            method: 'DELETE',
        })
        assert.equal(deleteResponse.status, 204)
        assert.equal(fs.existsSync(path.join(captureDir, finalFilename)), false)
    } finally {
        ws.close()
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
        fs.rmSync(captureDir, { recursive: true, force: true })
    }
})

import fs from 'node:fs'
import path from 'node:path'
import { decodePacket } from '@/util/packet-codec'

const SCHEMA_VERSION = 1

export class CaptureWriter {
    private readonly stream: fs.WriteStream
    private closed = false

    constructor(
        readonly filePath: string,
        readonly deviceId: string,
        options: { append?: boolean } = {},
    ) {
        this.stream = fs.createWriteStream(filePath, { flags: options.append ? 'a' : 'wx', mode: 0o600 })
        this.emit({ k: 'session', v: SCHEMA_VERSION, deviceId, tool: 'rethink-capture/0.2' })
    }

    marker(phase: string, meta?: object) {
        this.emit({ k: 'marker', phase, ...(meta ? { meta } : {}) })
    }

    event(event: object) {
        this.emit(event)
    }

    note(text: string) {
        const trimmed = text.trim().slice(0, 500)
        if (trimmed) this.emit({ k: 'note', author: 'human', text: trimmed })
    }

    recordWire(dir: 'fromDevice' | 'toDevice', raw: string, injected: boolean, mapped?: boolean) {
        if (!/^[0-9a-fA-F]*$/.test(raw)) {
            this.emit({ k: 'wire', dir, injected, mapped, raw })
            return
        }

        const decoded = decodePacket(raw)
        if (decoded.protocol === 'tlv') {
            this.emit({
                k: 'wire',
                dir,
                injected,
                mapped,
                hex: raw,
                protocol: 'tlv',
                crcOk: decoded.crcOk,
                frame: decoded.frame,
                tlv: decoded.tlv,
            })
        } else if (decoded.protocol === 'aabb') {
            this.emit({
                k: 'wire',
                dir,
                injected,
                mapped,
                hex: raw,
                protocol: 'aabb',
                checksumOk: decoded.checksumOk,
                body: decoded.body,
            })
        } else {
            this.emit({ k: 'wire', dir, injected, mapped, hex: raw, protocol: 'unknown' })
        }
    }

    close(phase = 'stopped') {
        if (this.closed) return Promise.resolve()
        this.marker(phase)
        this.closed = true
        return new Promise<void>((resolve, reject) => {
            this.stream.end((error?: Error | null) => (error ? reject(error) : resolve()))
        })
    }

    private emit(event: object) {
        if (this.closed) return
        this.stream.write(JSON.stringify({ ts: Date.now(), ...event }) + '\n')
    }
}

export function createCapture(captureDir: string, deviceId: string) {
    fs.mkdirSync(captureDir, { recursive: true, mode: 0o700 })
    const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const filename = `capture-${safeDeviceId}-${Date.now()}.jsonl`
    return { filename, writer: new CaptureWriter(path.join(captureDir, filename), deviceId) }
}

export function isCaptureFilename(filename: string) {
    return /^capture-[a-zA-Z0-9_-]+-\d+\.jsonl$/.test(filename)
}

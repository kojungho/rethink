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
    const created = new Date().toISOString().replace(/[-:]/g, '').replace('.', '').replace(/Z$/, 'Z')
    const filename = `capture-${safeDeviceId}-${created}.jsonl`
    return { filename, writer: new CaptureWriter(path.join(captureDir, filename), deviceId) }
}

export function captureLabel(note: string) {
    return Array.from(
        note
            .normalize('NFKC')
            .trim()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-+|-+$/g, ''),
    )
        .slice(0, 48)
        .join('')
}

export function labelCapture(captureDir: string, filename: string, note?: string) {
    const label = note ? captureLabel(note) : ''
    if (!label || !isCaptureFilename(filename)) return filename

    const stem = filename.slice(0, -'.jsonl'.length)
    let next = `${stem}-${label}.jsonl`
    for (let suffix = 2; fs.existsSync(path.join(captureDir, next)); suffix++) {
        next = `${stem}-${label}-${suffix}.jsonl`
    }
    fs.renameSync(path.join(captureDir, filename), path.join(captureDir, next))
    return next
}

export function isCaptureFilename(filename: string) {
    return (
        /^capture-[a-zA-Z0-9_-]+-\d+\.jsonl$/.test(filename) ||
        /^capture-[a-zA-Z0-9_-]+-\d{8}T\d{9}Z(?:-[\p{L}\p{N}_-]+)?\.jsonl$/u.test(filename)
    )
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createCapture, isCaptureFilename } from '@/util/capture'

test('capture writer records decoded wire events, markers, and notes as JSONL', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rethink-capture-'))
    try {
        const { filename, writer } = createCapture(dir, 'device-1')
        writer.marker('online', { modelId: 'H01' })
        writer.recordWire('fromDevice', 'AA2032EB001800000001270000000100000200000042804100000000000365BB', false)
        writer.note('Auto Dry turned on')
        await writer.close()

        assert.equal(isCaptureFilename(filename), true)
        assert.equal(fs.statSync(path.join(dir, filename)).mode & 0o777, 0o600)
        const events = fs
            .readFileSync(path.join(dir, filename), 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        assert.equal(events[0].k, 'session')
        assert.deepEqual(
            events.map((event) => event.k),
            ['session', 'marker', 'wire', 'note', 'marker'],
        )
        assert.equal(events[2].protocol, 'aabb')
        assert.equal(events[2].checksumOk, true)
        assert.equal(events[3].text, 'Auto Dry turned on')
        assert.equal(events[4].phase, 'stopped')
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

test('capture filenames reject path traversal and unrelated files', () => {
    assert.equal(isCaptureFilename('capture-device-1-123.jsonl'), true)
    assert.equal(isCaptureFilename('../capture-device-1-123.jsonl'), false)
    assert.equal(isCaptureFilename('options.json'), false)
})

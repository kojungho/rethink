// Capture recorder: subscribes to a device's management /device WebSocket, decodes
// every packet through packet-codec, and writes a time-ordered JSONL capture.
//
// It also reads annotations from stdin: type a line while operating the appliance
// (e.g. "turning fan to high") and it is recorded as a `note` event, time-aligned
// with the byte stream — the raw material for field inference.
//
// Usage:
//   tsx tools/rethink-capture.ts [--cloud] [--state <path>] <mgmt-host[:port]> <device-uuid> [out.jsonl]
//
// The /device WS is served on the management port (default 44401). It emits
//   {rx, injected} = device->cloud (fromDevice),  {tx, injected} = cloud->device (toDevice),
//   {status:'online'|'offline', meta}.
//
// With --cloud the recorder also attaches to the real LG cloud's notification feed and
// records {k:'cloud'} events on the same clock, so each fromDevice packet can be labelled
// by the cloud's decoded interpretation. If not logged in yet, it runs the interactive
// login (prompts for the country code, then the post-login URL) ONCE, up front — before
// stdin is taken over for notes. If the cloud login/connect fails, the recorder exits
// with an error rather than continuing a degraded capture.

import WebSocket from 'ws'
import readline from 'node:readline'
import { connect as connectCloud, login } from '@/util/lgcloud/monitor'
import { loadState, saveState } from '@/util/lgcloud/state'
import { CaptureWriter } from '@/util/capture'

// minimal flag parse; the rest are positional
//   --cloud         enable cloud correlation (logs in interactively if not already)
//   --state <path>   override the oauth.json state location
let cloud = false
let statePath: string | undefined
const positionals: string[] = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--cloud') cloud = true
    else if (a === '--state') statePath = argv[++i]
    else if (a.startsWith('--state=')) statePath = a.slice('--state='.length)
    else positionals.push(a)
}
const [hostArg, deviceId, outArg] = positionals
if (!hostArg || !deviceId) {
    console.error(
        'Usage: tsx tools/rethink-capture.ts [--cloud] [--state <path>] <mgmt-host[:port]> <device-uuid> [out.jsonl]',
    )
    process.exit(1)
}

const host = hostArg.includes(':') ? hostArg : `${hostArg}:44401`
const out = outArg ?? `capture-${deviceId}-${Date.now()}.jsonl`
const recorder = new CaptureWriter(out, deviceId, { append: true })

const url = `ws://${host}/device?id=${encodeURIComponent(deviceId)}`
console.error(`Connecting to ${url}\nWriting capture to ${out}`)

const ws = new WebSocket(url)

ws.on('open', () => recorder.marker('connected'))

ws.on('message', (data: WebSocket.RawData) => {
    let msg: any
    try {
        msg = JSON.parse(data.toString())
    } catch {
        return
    }
    if (typeof msg.rx === 'string') recorder.recordWire('fromDevice', msg.rx, !!msg.injected, msg.mapped)
    else if (typeof msg.tx === 'string') recorder.recordWire('toDevice', msg.tx, !!msg.injected, msg.mapped)
    else if (msg.status) recorder.marker(msg.status, msg.meta)
})

ws.on('close', () => {
    recorder.close('disconnected').then(() => process.exit(0))
})
ws.on('error', (err) => {
    console.error('WebSocket error:', err.message)
    process.exit(1)
})

process.on('SIGINT', () => {
    recorder.close().then(() => process.exit(0))
})

// Begin reading stdin for note events. Called only AFTER any interactive cloud login has
// finished, so the login's prompts and the note reader never contend for stdin.
function startNotes() {
    const rl = readline.createInterface({ input: process.stdin })
    rl.on('line', (line) => {
        const text = line.trim()
        if (text) recorder.note(text)
    })
    console.error('Type annotations and press enter; Ctrl-C to stop.')
}

// Optional cloud-oracle correlation. Interactive: logs in (prompting for country code +
// post-login URL) if there are no stored credentials, then connects. Any failure throws.
async function setupCloud() {
    if (!cloud) return
    let state = loadState(statePath)
    if (!state) {
        console.error('[cloud] no stored credentials — logging in now (before note capture starts)')
        state = await login()
        saveState(state, statePath)
        recorder.marker('cloud-logged-in')
    }
    await connectCloud(state, {
        log: (m) => console.error(`[cloud] ${m}`),
        onMessage: ({ topic, payload, raw }) => {
            // best-effort attribution: does this notification mention our device?
            const matchesDevice = raw.includes(deviceId)
            if (payload !== null) recorder.event({ k: 'cloud', topic, matchesDevice, state: payload })
            else recorder.event({ k: 'cloud', topic, matchesDevice, text: raw })
        },
    })
    recorder.marker('cloud-connected')
}

setupCloud().then(
    () => startNotes(),
    (err) => {
        console.error(`[cloud] login/connect failed: ${err.message}`)
        recorder.marker('cloud-failed', { reason: err.message })
        recorder.close('cloud-failed').then(() => process.exit(1))
    },
)

document.addEventListener('DOMContentLoaded', function () {})

let ws
let reconnectTimer
let activeCapture
let messageSequence = 0
let messageFilter = 'all'
const messageCounts = { all: 0, mapped: 0, unmapped: 0 }

const deviceId = new URLSearchParams(window.location.search).get('id')
get('device_id').innerText = deviceId
get('device_status').innerText = rethinkI18n.t('status.waiting', 'Waiting for rethink connection...')
document.querySelectorAll('[data-message-filter]').forEach((button) => {
    button.onclick = () => setMessageFilter(button.dataset.messageFilter)
})
get('clear_messages').onclick = clearMessageHistory

get('capture_start').onclick = () => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ captureStart: true }))
}
get('capture_stop').onclick = () => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ captureStop: true }))
}
get('capture_note_add').onclick = addCaptureNote
get('capture_note').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addCaptureNote()
})

// The socket lives at /device, a sibling of this page. Appending to the page's own path instead
// asks for /monitordevice, which nothing serves.
function deviceSocketUrl() {
    const url = new URL('device', window.location.href)
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    url.search = window.location.search
    return url
}

// As on the panel: first retry near-immediately, back off only if that fails too.
let retryDelay = 250

function connect() {
    clearTimeout(reconnectTimer)
    if (ws) {
        ws.onclose = ws.onopen = ws.onmessage = null
        try {
            ws.close()
        } catch {}
    }
    ws = new WebSocket(deviceSocketUrl())

    ws.onclose = () => {
        reconnectTimer = setTimeout(connect, retryDelay)
        retryDelay = 5000
        get('device_status').innerText = rethinkI18n.t('status.waiting', 'Waiting for rethink connection...')
        get('capture_start').disabled = true
        get('capture_stop').disabled = true
        get('capture_note_add').disabled = true
    }

    ws.onopen = () => {
        retryDelay = 250
        get('device_status').innerText = rethinkI18n.t('status.offline', 'offline')
        get('capture_start').disabled = false
    }

    ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
            const json = JSON.parse(ev.data)
            if (json.rx) {
                const div = pushMessage('rx', json.rx, json.injected, json.mapped)
                div.onclick = () => {
                    get('send2').value = json.rx
                    M.updateTextFields()
                }
            }

            if (json.tx) {
                const div = pushMessage('tx', json.tx, json.injected, json.mapped)
                div.onclick = () => {
                    get('send1').value = json.tx
                    M.updateTextFields()
                }
            }

            if (json.status) {
                get('device_status').innerText = rethinkI18n.t(`status.${json.status}`, json.status)
                if (json.status === 'online') {
                    get('btn_send1').disabled = false
                    get('btn_send1').onclick = () => {
                        let cmd = get('send1').value
                        if (cmd[0] === '{') cmd = JSON.parse(cmd)

                        ws.send(JSON.stringify({ sendToDevice: cmd }))
                    }

                    get('btn_send2').disabled = false
                    get('btn_send2').onclick = () => {
                        ws.send(JSON.stringify({ sendFromDevice: get('send2').value }))
                    }
                } else {
                    get('btn_send1').disabled = true
                    get('btn_send2').disabled = true
                }
            }

            if (json.meta) {
                get('device_model').innerText = json.meta.modelId
            }

            if ('name' in json) {
                get('device_name').innerText = json.name
            }

            if (json.capture) {
                if (json.capture.error) {
                    setCaptureState(false)
                    get('capture_status').innerText =
                        `${rethinkI18n.t('capture.error', 'Error')}: ${json.capture.error}`
                } else if (json.capture.active) {
                    if (json.capture.filename) activeCapture = json.capture.filename
                    setCaptureState(true)
                    if (json.capture.noteSaved) get('capture_note').value = ''
                } else {
                    const filename = json.capture.filename || activeCapture
                    setCaptureState(false)
                    if (filename) addCaptureLink(filename)
                    activeCapture = undefined
                }
            }
        }
    }
}

// Same as the panel, and for the same reason its readyState check had to go: the restored socket can
// still read as OPEN here and only report its close afterwards.
window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) connect()
})

function pushMessage(direction, payload, injected, mapped) {
    const timestamp = document.createElement('span')
    const messages = get('messages')
    const hexPayload = typeof payload === 'string' && /^[0-9a-f]+$/i.test(payload) && payload.length % 2 === 0
    const details = document.createElement('span')

    timestamp.innerText = new Date().toLocaleTimeString()
    timestamp.classList.add('timestamp')
    messageSequence += 1
    const div = document.createElement('div')
    div.classList.add(direction, 'message')
    const mappingClass = mapped === true ? 'mapped' : 'unmapped'
    const mappingLabel = rethinkI18n.t(`mapping.${mappingClass}`, mappingClass === 'mapped' ? 'Mapped' : 'Unmapped')
    details.innerText = `#${messageSequence} ${direction.toUpperCase()}${hexPayload ? ` ${payload.length / 2} B` : ''} · ${mappingLabel}`
    details.classList.add('message_details')
    div.classList.add(mappingClass)
    if (messageFilter !== 'all' && messageFilter !== mappingClass) div.classList.add('filtered_out')
    if (injected) div.classList.add('injected')
    div.innerText = payload
    div.prepend(details)
    div.appendChild(timestamp)

    messages.appendChild(div)
    messageCounts.all += 1
    messageCounts[mappingClass] += 1
    updateMessageCounts()

    if (get('autoscroll').checked) messages.scrollTop = messages.scrollHeight

    return div
}

function setMessageFilter(filter) {
    if (!['all', 'mapped', 'unmapped'].includes(filter)) return
    messageFilter = filter
    document.querySelectorAll('[data-message-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.messageFilter === filter)
    })
    document.querySelectorAll('#messages .message').forEach((message) => {
        message.classList.toggle('filtered_out', filter !== 'all' && !message.classList.contains(filter))
    })
}

function updateMessageCounts() {
    for (const filter of ['all', 'mapped', 'unmapped']) get(`count_${filter}`).innerText = messageCounts[filter]
}

function clearMessageHistory() {
    get('messages').replaceChildren()
    messageSequence = 0
    messageCounts.all = 0
    messageCounts.mapped = 0
    messageCounts.unmapped = 0
    updateMessageCounts()
}

function get(id) {
    return document.getElementById(id)
}

function addCaptureNote() {
    const note = get('capture_note').value.trim()
    if (note && ws?.readyState === WebSocket.OPEN && activeCapture) {
        ws.send(JSON.stringify({ captureNote: note }))
    }
}

function setCaptureState(active) {
    get('capture_start').disabled = active || ws?.readyState !== WebSocket.OPEN
    get('capture_stop').disabled = !active
    get('capture_note_add').disabled = !active
    get('capture_status').innerText = active
        ? `${rethinkI18n.t('capture.recording', 'Recording')}: ${activeCapture}`
        : rethinkI18n.t('capture.stopped', 'Stopped')
}

function captureUrl(path) {
    return new URL(path, window.location.href)
}

function addCaptureLink(filename, size) {
    if (get(`capture-${filename}`)) return
    const row = document.createElement('div')
    row.id = `capture-${filename}`
    const link = document.createElement('a')
    link.href = captureUrl(`capture/${encodeURIComponent(filename)}`)
    link.download = filename
    link.innerText = filename + (size === undefined ? '' : ` (${Math.ceil(size / 1024)} KiB)`)
    row.appendChild(link)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn-flat btn-small red-text capture_delete'
    remove.innerText = rethinkI18n.t('capture.delete', 'Delete')
    remove.onclick = async () => {
        if (!window.confirm(rethinkI18n.t('capture.delete_confirm', `Delete ${filename}?`))) return
        remove.disabled = true
        try {
            const response = await fetch(captureUrl(`capture/${encodeURIComponent(filename)}`), { method: 'DELETE' })
            if (response.ok) row.remove()
            else throw new Error(`${response.status}`)
        } catch {
            remove.disabled = false
            window.alert(rethinkI18n.t('capture.delete_failed', 'Could not delete the capture file.'))
        }
    }
    row.appendChild(remove)
    get('capture_files').prepend(row)
}

async function loadCaptures() {
    try {
        const url = captureUrl('captures')
        url.searchParams.set('id', deviceId)
        const response = await fetch(url)
        if (!response.ok) return
        const body = await response.json()
        for (const capture of body.captures ?? []) addCaptureLink(capture.filename, capture.size)
    } catch {}
}

connect()
loadCaptures()

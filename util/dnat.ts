import { Resolver } from 'node:dns'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createSecureContext } from 'node:tls'
import type { SecureContext } from 'node:tls'
import { createHash } from 'node:crypto'
import type { CA } from './config'

const LG_HOSTNAME = /^(?:[a-z0-9-]+\.)+lgthinq\.com$/i

export function isAllowedDnatHostname(hostname: string) {
    return LG_HOSTNAME.test(hostname)
}

function openssl(args: string[]) {
    const result = spawnSync('openssl', args, { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`openssl failed: ${result.stderr.trim()}`)
}

export function createSniContextFactory(ca: CA, caKeyFile: string, caCertFile: string) {
    const contexts = new Map<string, SecureContext>()

    return (servername: string, callback: (error: Error | null, context?: SecureContext) => void) => {
        try {
            const hostname = servername.toLowerCase().replace(/\.$/, '')
            if (!isAllowedDnatHostname(hostname)) {
                callback(null, createSecureContext(ca))
                return
            }

            let context = contexts.get(hostname)
            if (!context) {
                const directory = mkdtempSync(join(tmpdir(), 'rethink-sni-'))
                try {
                    const keyFile = join(directory, 'server.key')
                    const csrFile = join(directory, 'server.csr')
                    const certFile = join(directory, 'server.crt')
                    const extensionsFile = join(directory, 'extensions.cnf')
                    writeFileSync(extensionsFile, `subjectAltName=DNS:${hostname}\nextendedKeyUsage=serverAuth\n`)

                    openssl([
                        'req',
                        '-new',
                        '-newkey',
                        'rsa:2048',
                        '-nodes',
                        '-keyout',
                        keyFile,
                        '-out',
                        csrFile,
                        '-subj',
                        `/CN=${hostname}`,
                    ])
                    openssl([
                        'x509',
                        '-req',
                        '-in',
                        csrFile,
                        '-CA',
                        caCertFile,
                        '-CAkey',
                        caKeyFile,
                        '-set_serial',
                        `0x${createHash('sha256').update(hostname).digest('hex').slice(0, 32)}`,
                        '-out',
                        certFile,
                        '-days',
                        '3650',
                        '-sha256',
                        '-extfile',
                        extensionsFile,
                    ])
                    context = createSecureContext({ key: readFileSync(keyFile), cert: readFileSync(certFile) })
                    contexts.set(hostname, context)
                    console.log(`Created DNAT TLS certificate for ${hostname}`)
                } finally {
                    rmSync(directory, { recursive: true, force: true })
                }
            }
            callback(null, context)
        } catch (error) {
            callback(error as Error)
        }
    }
}

export async function fetchOfficialRoute(
    hostname: string,
    headers: Record<string, string | string[] | undefined>,
    dnsServers: string[],
) {
    if (!isAllowedDnatHostname(hostname)) throw new Error(`Refusing non-LG DNAT hostname: ${hostname}`)

    const resolver = new Resolver()
    resolver.setServers(dnsServers)
    const addresses = await resolver.resolve4(hostname)
    if (!addresses.length) throw new Error(`No IPv4 address returned for ${hostname}`)

    return await new Promise<unknown>((resolve, reject) => {
        const forwardedHeaders = { ...headers, host: hostname }
        delete forwardedHeaders.connection
        delete forwardedHeaders['content-length']

        const req = request(
            {
                host: addresses[0],
                servername: hostname,
                port: 443,
                path: '/route',
                method: 'GET',
                headers: forwardedHeaders,
                timeout: 10_000,
            },
            (response) => {
                const chunks: Buffer[] = []
                response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
                response.on('end', () => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`Official route returned HTTP ${response.statusCode}`))
                        return
                    }
                    try {
                        console.log(`Proxied official ThinQ route for ${hostname} via ${addresses[0]}`)
                        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
                    } catch {
                        reject(new Error('Official route returned invalid JSON'))
                    }
                })
            },
        )
        req.on('timeout', () => req.destroy(new Error('Official route request timed out')))
        req.on('error', reject)
        req.end()
    })
}

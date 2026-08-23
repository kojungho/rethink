import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAllowedDnatHostname } from '@/util/dnat'

test('DNAT hostname validation only accepts LG ThinQ hosts', () => {
    assert.equal(isAllowedDnatHostname('common.lgthinq.com'), true)
    assert.equal(isAllowedDnatHostname('common.iot.kic.lgthinq.com'), true)
    assert.equal(isAllowedDnatHostname('KIC-MCLIP.LGTHINQ.COM'), true)
    assert.equal(isAllowedDnatHostname('rethink.home.arpa'), false)
    assert.equal(isAllowedDnatHostname('lgthinq.com.attacker.example'), false)
    assert.equal(isAllowedDnatHostname('127.0.0.1'), false)
})

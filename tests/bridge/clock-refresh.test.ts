import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockRefreshPeriod, PAC_CLOCK_REFRESH_PERIOD } from '@/bridge'

test('refreshes only the PAC model before its one-hour standby clock expires', () => {
    assert.equal(clockRefreshPeriod('PAC_910604_WW'), 45 * 60 * 1000)
    assert.equal(clockRefreshPeriod('PAC_910604_WW'), PAC_CLOCK_REFRESH_PERIOD)
    assert.equal(clockRefreshPeriod('RAC_056905_WW'), undefined)
    assert.equal(clockRefreshPeriod(undefined), undefined)
})

import TLVDevice, { FieldDefinition } from './tlv_device'
import { Device as Thinq2Device } from '../thinq2/device'
import { ClimateComponent, DeviceDiscovery, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import * as TLV from '@/util/tlv'
import { racAirTemp, racPipeTemp } from '@/util/ac_tables'
import log from '@/util/logging'
import HADevice from './base'

type PowerModeChangeHook = () => void
type CheckMode = (arg: number) => boolean
export default class Device extends TLVDevice {
    meta: Metadata
    initialValuesReceived: boolean = false
    powerChangeHooks: PowerModeChangeHook[] = []
    powerStatePrev?: boolean
    modeChangeHooks: PowerModeChangeHook[] = []
    modePrev?: string
    airClean: boolean = false
    jetMode: boolean = false
    energySave: boolean = false
    tlvBlacklistDisableTimer: ReturnType<typeof setTimeout> | undefined
    increasedQueryIntervalTimeout: ReturnType<typeof setTimeout> | undefined
    filterUsedTime: number = 0
    filterLifeTime: number = 0
    filterChangedDate: number = 0
    filterInitialQueryTimeout: ReturnType<typeof setTimeout> | undefined
    filterQueryTimer: ReturnType<typeof setInterval> | undefined
    filterDoReset: boolean = false

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.meta = meta
    }

    processKeyValue(k: number, v: number) {
        super.processKeyValue(k, v)

        // On this model AI drying is stopped through the Auto-dry tag rather
        // than the fan-level tag used to enable it. Keep the select state in
        // sync with that acknowledgement.
        if (k === 0x20e && v === 0 && this.fields_by_ha['ai_dry-']) {
            this.HA.publishProperty(this.id, 'ai_dry-', '끔')
        }
    }

    drop() {
        if (this.tlvBlacklistDisableTimer != undefined) {
            clearTimeout(this.tlvBlacklistDisableTimer)
            this.tlvBlacklistDisableTimer = undefined
        }

        if (this.increasedQueryIntervalTimeout != undefined) {
            clearTimeout(this.increasedQueryIntervalTimeout)
            this.increasedQueryIntervalTimeout = undefined
        }

        if (this.filterInitialQueryTimeout != undefined) {
            clearTimeout(this.filterInitialQueryTimeout)
            this.filterInitialQueryTimeout = undefined
        }

        if (this.filterQueryTimer != undefined) {
            clearInterval(this.filterQueryTimer)
            this.filterQueryTimer = undefined
        }

        super.drop()
    }

    processPrivData(cmd: number, buf9: number, data: Buffer) {
        if (cmd == 0x02) this.processFilterData(buf9, data)
    }

    processPrivDataCmdResp(success: boolean, buf1: number, cmd: number, data: Buffer) {
        if (cmd == 0x2) this.processFilterCmdResp(success, data)
    }

    sendFilterQuery() {
        this.sendPrivCommand(0x02, 0x02)
    }

    sendFilterReset() {
        if (!this.filterLifeTime) throw new Error('Filter lifetime not known')

        const now = new Date()
        const date = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate()

        const buf = Buffer.alloc(4 * 3)
        // yes, it's opposite endianness vs read cmd
        buf.writeUInt32BE(this.filterLifeTime, 1 * 4)
        buf.writeUInt32BE(date, 2 * 4)

        log('status', this.id, 'sending filter reset')
        this.sendPrivCommand(0x02, 0x01, buf)
    }

    isCapsResponse(tlvArray: TLV.TLV[]) {
        /* eeprom checksum */
        return tlvArray.some(({ t, v }) => t === 0x2da)
    }

    isValuesResponse(tlvArray: TLV.TLV[]) {
        /* power */
        return tlvArray.length >= 10 && tlvArray.some(({ t, v }) => t === 0x1f7)
    }

    valuesReceived() {
        if (this.initialValuesReceived) return
        this.initialValuesReceived = true

        // we want to be informed about all TLV changes - set an empty blacklist
        this.thinq.send('setMaskingInfo', 0, { blacklist_tlv: '1200' })

        // give modem some time to process the command before continuing
        this.tlvBlacklistDisableTimer = setTimeout(() => {
            this.tlvBlacklistDisableTimer = undefined

            if (!(this.raw_clip_state[0x2f1] & 1 || this.raw_clip_state[0x2f1] & 0x200)) {
                // no mFilter, check basic filter management support
                this.initProbeForFilter()
            } else {
                // unsupported mFilter management support
                this.initMakeSetConfig()
            }
        }, 500)
    }

    initProbeForFilter() {
        log('status', this.id, 'sending initial filter data query')
        this.sendFilterQuery()

        this.filterInitialQueryTimeout = setTimeout(() => {
            this.filterInitialQueryTimeout = undefined

            log('status', this.id, 'filter data query timeout, assuming no filter')
            this.initMakeSetConfig()
        }, 5 * 1000)
    }

    processFilterData(buf9: number, data: Buffer) {
        if (data.length < 1 + 3 * 4) {
            log('status', this.id, 'filter data too short:', data.length)
            return
        }

        this.filterUsedTime = data.readUInt32LE(1 + 0 * 4)
        this.filterLifeTime = data.readUInt32LE(1 + 1 * 4)
        this.filterChangedDate = data.readUInt32LE(1 + 2 * 4)

        // if this was the initial filter query the device config is ready now
        if (this.filterInitialQueryTimeout != undefined) {
            log('status', this.id, 'received initial filter data')

            clearTimeout(this.filterInitialQueryTimeout)
            this.filterInitialQueryTimeout = undefined

            this.initMakeSetConfig()
        } else {
            // if this was not the initial query just update the HA values
            this.publishFilterData()
        }

        if (this.filterDoReset) {
            this.filterDoReset = false
            this.sendFilterReset()
        }
    }

    publishFilterData() {
        const changedDate =
            Math.floor(this.filterChangedDate / 10000)
                .toString()
                .padStart(4, '0') +
            '-' +
            (Math.floor(this.filterChangedDate / 100) % 100).toString().padStart(2, '0') +
            '-' +
            (this.filterChangedDate % 100).toString().padStart(2, '0')

        this.HA.publishProperty(this.id, 'filterused', this.filterUsedTime)
        this.HA.publishProperty(this.id, 'filterlife', this.filterLifeTime)
        this.HA.publishProperty(this.id, 'filterchangeddate', changedDate)
    }

    processFilterCmdResp(success: boolean, data: Buffer) {
        if (!success) {
            log('status', this.id, 'filter reset failed')
            return
        }

        log('status', this.id, 'filter reset okay, re-querying')
        this.sendFilterQuery()
    }

    updateClimateAction() {
        // also updates query interval
        const modeTLV = this.getModeTLV()

        let iduRunning = true
        const iduRunningTLVNum = this.getIDUActionRunningTLVNum()
        if (iduRunningTLVNum != null) {
            iduRunning = this.raw_clip_state[iduRunningTLVNum] !== 0
        }

        const modes2ha = ['cooling', 'drying', 'fan', undefined, 'heating']
        let action: string | undefined = undefined
        let increaseQueryInterval = false
        if (this.getPowerTLV() === 0) {
            action = 'off'
        } else if ((modeTLV === 0 || modeTLV === 1 || modeTLV === 4 || modeTLV === 6) && !iduRunning) {
            action = 'idle'
        } else if (modeTLV === 6) {
            // TODO: figure out how to detect the actual running mode in Auto
            // For now, clear the reported action.
            action = 'None'
            increaseQueryInterval = true // assume it is running
        } else if (modeTLV === 46) {
            // Air purification is an operating mode on RAC_056905_WW, not
            // the optional air-cleaning switch.
            action = 'fan'
        } else {
            action = modes2ha[modeTLV]
            increaseQueryInterval = action != null && action !== 'fan'
        }

        if (action != null) this.HA.publishProperty(this.id, 'climate-action', action)
        this.updateQueryInterval(increaseQueryInterval)
    }

    updateQueryInterval(increaseQueryInterval: boolean) {
        if (increaseQueryInterval) {
            if (this.increasedQueryIntervalTimeout != undefined) {
                clearTimeout(this.increasedQueryIntervalTimeout)
                this.increasedQueryIntervalTimeout = undefined
            }

            /*
             * When in one of active modes update more frequently
             * since parameters can change rapidly:
             * every a bit less than half a minute.
             *
             * This matches the observed ODU parameter recalculation intervals:
             * compressor Hz - every 30 seconds,
             * EEV openings - every 30 seconds during transient periods.
             */
            this.setQueryInterval((30 - 2) * 1000)
        } else if (this.increasedQueryIntervalTimeout == null) {
            /*
             * Reset to the default interval after 15 minutes,
             * hopefully things returned to steady idle state by this time.
             */
            this.increasedQueryIntervalTimeout = setTimeout(
                () => {
                    this.increasedQueryIntervalTimeout = undefined
                    this.setQueryInterval()
                },
                15 * 60 * 1000,
            )
        }
    }

    getPowerTLV() {
        return this.raw_clip_state[0x1f7]
    }

    getModeTLV() {
        return this.raw_clip_state[0x1f9]
    }

    getIDUActionRunningTLVNum() {
        if (this.raw_clip_state[0x189] != null) {
            return 0x189 // IDUThermoOnOff
        }
        if (this.raw_clip_state[0x6c] != null) {
            return 0x6c
        }

        return undefined
    }

    initMakeSetConfig() {
        const config: DeviceDiscovery & { components: { climate: ClimateComponent } } = allowExtendedType({
            ...HADevice.config(this.meta, { name: 'LG Air Conditioner' }),
            components: {
                climate: {
                    platform: 'climate',
                    unique_id: '$deviceid-climate',
                    name: null,
                    action_topic: '$this/climate-action',
                    temperature_unit: 'C',
                    /* TODO: detect 0.5 C vs 1 C step */
                    temp_step: 0.5,
                    precision: 0.5,
                    /* TODO: some devices report these temp ranges via tags 0x2e1 - 0x2ec */
                    min_temp: 18,
                    max_temp: 30,
                    // This cooling-only model does not implement Auto or Heat.
                    modes: ['off', 'cool', 'dry', 'fan_only'],
                    // The appliance reports air purification as mode 46.  It
                    // is represented as a preset because HA climate modes are
                    // limited to standard HVAC modes.
                    preset_modes: ['공기 청정'],
                    preset_mode_state_topic: '$this/climate-preset_mode',
                    preset_mode_command_topic: '$this/climate-preset_mode/set',
                    /* TODO: get from 0x2c2 */
                    fan_modes: ['auto', 'very low', 'low', 'medium', 'high', 'very high'],
                    /* TODO: get allowed op modes from 0x2c1 */
                } satisfies ClimateComponent,
            },
        })

        this.addField(config, {
            id: 0x1fd,
            name: 'current_temperature',
            comp: 'climate',
            state_topic: 'topic',
            writable: false,
            read_xform: (raw) => raw / 2,
        })
        this.addField(config, {
            id: 0x1f7,
            name: 'power',
            comp: 'climate',
            readable: false,
            write_xform: (val) => (val === 'ON' ? 1 : 0),
            /*  0x1f7 is not necessary for ON but does not seem to hurt either */
            write_attach: (raw) => (raw ? [0x1f9, 0x1fa, 0x1fe] : []),
            read_xform: (raw) => (raw ? 'ON' : 'OFF'),
            read_callback: (val) => {
                /*
                 * Update 'mode' instead.
                 *
                 * This means that power state change will effectively also
                 * call mode change hooks since mode will switch between 'off'
                 * and the actual set mode.
                 */
                this.processKeyValue(0x1f9, this.raw_clip_state[0x1f9])

                /*
                 * Call these hooks only after updating 'mode' in case
                 * they depend on it being correctly set.
                 */
                const powerState = val === 'ON'
                if (this.powerStatePrev !== powerState) for (const hook of this.powerChangeHooks) hook()
                this.powerStatePrev = powerState

                return false
            },
        })

        this.addField(config, {
            id: 0x1f9,
            name: 'mode',
            comp: 'climate',
            read_xform: (raw) => {
                const modes2ha = ['cool', 'dry', 'fan_only']
                if (this.getPowerTLV() === 0) return 'off'
                if (raw === 46) return 'fan_only'
                return modes2ha[raw]
            },
            read_callback: (val) => {
                this.HA.publishProperty(this.id, 'climate-preset_mode', this.getModeTLV() === 46 ? '공기 청정' : 'none')
                if (typeof val !== 'string') return true
                if (this.modePrev !== val) for (const hook of this.modeChangeHooks) hook()
                this.modePrev = val
                return true
            },
            write_xform: (val) => {
                const modes2clip: Record<string, number> = { cool: 0, dry: 1, fan_only: 2 }
                if (val === 'off') {
                    // Call function power (0x1f7) with value OFF
                    this.setProperty('climate-power', 'OFF')
                    return null
                }
                return modes2clip[val]
            },
            write_attach: [0x1fa, 0x1fe],
        })

        // `preset_mode` controls the same wire field as the climate mode, so
        // it is registered manually rather than as a second read field.
        this.fields_by_ha['climate-preset_mode'] = {
            name: 'preset_mode',
            comp: 'climate',
            write_xform: (val) => (val === '공기 청정' ? 46 : null),
            write_callback: (val) => {
                this.raw_clip_state[0x1f9] = val
                this.send([1, 1, 2, 1, 1], [{ t: 0x1f9, v: val }])
                return false
            },
        }

        this.addField(config, {
            id: 0x1fa,
            name: 'fan_mode',
            comp: 'climate',
            read_xform: (raw) => {
                const modes2ha = [
                    undefined,
                    undefined,
                    'very low',
                    'low',
                    'medium',
                    'high',
                    'very high',
                    undefined,
                    'auto',
                ]
                return modes2ha[raw]
            },
            write_xform: (val) => {
                const modes2clip: Record<string, number> = {
                    'very low': 2,
                    low: 3,
                    medium: 4,
                    high: 5,
                    'very high': 6,
                    auto: 8,
                }
                return modes2clip[val]
            },
            write_attach: [0x1f9, 0x1fe],
        })

        this.addField(config, {
            id: 0x1fe,
            name: 'temperature',
            comp: 'climate',
            read_xform: (raw) => raw / 2,
            write_xform: (val) => Math.round(Number(val) * 2),
            write_attach: [0x1f9, 0x1fa],
        })

        if (this.raw_clip_state[0x2cd] & 4) {
            config['components']['climate']['swing_modes'] = [
                '1(상)',
                '2',
                '3',
                '4',
                '5',
                '6(하)',
                '상단집중',
                '중간집중',
                '하단집중',
                '상하회전',
                '정지',
            ]
            this.addField(config, {
                id: 0x321,
                name: 'swing_mode',
                comp: 'climate',
                read_xform: (raw) => {
                    const modes2ha = ['정지', '1(상)', '2', '3', '4', '5', '6(하)']
                    modes2ha[14] = '상단집중'
                    modes2ha[25] = '중간집중'
                    modes2ha[36] = '하단집중'
                    modes2ha[100] = '상하회전'
                    return modes2ha[raw]
                },
                write_xform: (val) => {
                    const modes2clip: Record<string, number> = {
                        '정지': 0,
                        '1(상)': 1,
                        '2': 2,
                        '3': 3,
                        '4': 4,
                        '5': 5,
                        '6(하)': 6,
                        '상단집중': 14,
                        '중간집중': 25,
                        '하단집중': 36,
                        '상하회전': 100,
                    }
                    return modes2clip[val]
                },
            })
        }

        if (this.raw_clip_state[0x2cd] & 8) {
            config['components']['climate']['swing_horizontal_modes'] = [
                '1(좌)',
                '2',
                '3',
                '4',
                '5(우)',
                '좌중회전',
                '중우회전',
                '좌우회전',
                '정지',
            ]
            this.addField(config, {
                id: 0x322,
                name: 'swing_horizontal_mode',
                comp: 'climate',
                read_xform: (raw) => {
                    const modes2ha = ['정지', '1(좌)', '2', '3', '4', '5(우)']
                    modes2ha[13] = '좌중회전'
                    modes2ha[35] = '중우회전'
                    modes2ha[100] = '좌우회전'
                    return modes2ha[raw]
                },
                write_xform: (val) => {
                    const modes2clip: Record<string, number> = {
                        '정지': 0,
                        '1(좌)': 1,
                        '2': 2,
                        '3': 3,
                        '4': 4,
                        '5(우)': 5,
                        '좌중회전': 13,
                        '중우회전': 35,
                        '좌우회전': 100,
                    }
                    return modes2clip[val]
                },
            })
        }

        this.addOptionalSensorField(config, 0x221, 'error', 'Error code', 'mdi:alert')
        this.addOptionalSensorField(
            config,
            0x32e,
            'capacity',
            'Capacity nominal',
            undefined,
            {
                device_class: 'power',
                unit_of_measurement: 'kW',
                suggested_display_precision: 1,
            },
            (raw) => (raw !== 0 ? Math.round(raw * 0.293 * 10) / 10 : undefined),
        ) // raw is in kBTU / hour

        /*
         * Whether the IDU will report its EEV opening correctly during its
         * active operation is highly inconsistent between IDUs.
         * For example, from two Standard2 IDUs with 0x690409 software version
         * connected to common ODU one IDU works as expected while the other
         * one reports the EEV opening value of the other Standard2 IDU (?).
         * This may be an ODU firmware bug. On the other hand, another Deluxe
         * IDU connected to the same ODU always reports correct EEV values.
         * None of tested IDUs seem to usually notify by itself when this value changes.
         */
        this.addOptionalSensorField(config, 0x330, 'eev', 'EEV opening', 'mdi:valve', {
            state_class: 'measurement',
            suggested_display_precision: 0,
        })

        /*
         * IDUs send notifications about the updates of the temperatures below
         * at their own pace, sometimes in clusters with other attributes.
         * Deluxe IDUs send notifications noticeably more often than Standard2 IDUs.
         *
         * Pipe temps are sometimes reported as 0 (-100 C) for a moment after a shutdown.
         * Make sure to filter out such updates.
         */
        this.addOptionalSensorTempField(
            config,
            0x2f9,
            'pipeintemp',
            'Pipe liquid temperature',
            'mdi:pipe',
            (raw) => racPipeTemp[255 - raw],
        )
        this.addOptionalSensorTempField(
            config,
            0x2fa,
            'pipeouttemp',
            'Pipe gas temperature',
            'mdi:pipe',
            (raw) => racPipeTemp[255 - raw],
        )

        this.addOptionalSensorTempField(
            config,
            [0x7a, 0x32c],
            'oduhextemp',
            'ODU HEX temperature', // "HEX" = "heat exchanger"
            'mdi:heating-coil',
            (raw) => racPipeTemp[255 - raw],
        )
        this.addOptionalSensorTempField(
            config,
            0x332,
            'oduairtemp',
            'ODU air temperature',
            'mdi:thermometer-lines',
            (raw) => racAirTemp[255 - raw],
        )

        /*
         * [ 0x22a, 0x32f ] - ODU compressor Hz
         * Standard2 IDUs even notify about the former
         * tag changes.
         *
         * But the value seems to be capped at 15 Hz
         * regardless of the actual compressor speed,
         * which makes it of limited usability.
         */

        // 0x2fb is the target fan RPM, while this is the current RPM
        this.addOptionalSensorField(
            config,
            0x331,
            'fanrpm',
            'Fan RPM',
            'mdi:fan',
            {
                state_class: 'measurement',
                unit_of_measurement: 'rpm',
                suggested_display_precision: 0,
            },
            (raw) => raw * 10,
        )

        if (this.raw_clip_state[0x2cc] & 1) {
            this.addModeDependentConfigSwitchField(
                config,
                0x20f,
                'airclean',
                /* Same desc as in lg_thinq */
                '공기 청정',
                'mdi:air-purifier',
                'airClean',
            )
        }

        const jetCool: boolean = !!(this.raw_clip_state[0x2cd] & 1)
        const jetHeat: boolean = !!(this.raw_clip_state[0x2cd] & 2)
        if (jetCool || jetHeat) {
            this.addJetField(config, 0x323, 'jet', 'Jet', 'mdi:snowflake', jetCool, jetHeat)
        }

        if (this.raw_clip_state[0x2d3] & 1) {
            // 15h - displayed in hex as "FH"
            this.addTimerField(config, 0x21a, 'sleeptimer', 'Sleep timer', 'mdi:bed-clock', 15)
        }

        if (this.raw_clip_state[0x2d3] & 4) {
            this.addTimerField(config, 0x21c, 'starttimer', 'Turn-on timer', 'mdi:timer-play', 24)
            this.addTimerField(config, 0x21b, 'stoptimer', 'Turn-off timer', 'mdi:timer-stop', 24)
        }

        if (this.raw_clip_state[0x2cc] & 2) {
            // Can be enabled only when running in the cooling mode
            this.addModeDependentConfigSwitchField(
                config,
                0x20d,
                'energysave',
                '절전',
                'mdi:leaf',
                'energySave',
                (mode) => mode === 0,
            )
        }

        // These device-setting tags were confirmed from RAC_056905_WW
        // command captures. The display and button-sound flags are inverted:
        // 0 means enabled, 1 means disabled.
        this.addInvertedConfigSwitchField(config, 0x21f, 'display_light', '제품 화면', 'mdi:monitor')
        this.addInvertedConfigSwitchField(config, 0x3a0, 'button_sound', '제품 소리', 'mdi:volume-high')

        const aiDry = {
            platform: 'select',
            unique_id: '$deviceid-ai-dry',
            name: 'AI 건조',
            icon: 'mdi:hair-dryer',
            entity_category: 'config',
            options: ['끔', '약풍', '중풍', '강풍'],
        }
        config['components']['ai_dry'] = aiDry
        this.addField(config, {
            id: 0x1f2,
            name: '',
            comp: 'ai_dry',
            read_xform: (raw) => ({ 0: '끔', 2: '약풍', 4: '중풍', 6: '강풍' } as Record<number, string>)[raw],
            write_xform: (val) => ({ '끔': 0, '약풍': 2, '중풍': 4, '강풍': 6 } as Record<string, number>)[val],
            write_callback: (value) => {
                if (value !== 0) return true

                // LG uses tag 0x20e (Auto-dry state) to stop AI drying.
                this.raw_clip_state[0x20e] = 0
                this.send([1, 1, 2, 1, 1], [{ t: 0x20e, v: 0 }])
                return false
            },
        })

        this.addConfigSwitchField(config, 0x3a2, 'heat_exchanger_cleaning', '열교환기 세척', 'mdi:air-filter')
        this.addConfigSwitchFieldWithValues(
            config,
            0x165,
            'all_cleaning',
            '올클리닝',
            'mdi:air-filter',
            100,
            8,
        )

        if (this.raw_clip_state[0x2cc] & 4) {
            const compADry = {
                platform: 'binary_sensor',
                unique_id: '$deviceid-autodry',
                name: 'Auto dry',
                icon: 'mdi:hair-dryer',
                entity_category: 'diagnostic',
            }
            const compADryRem = {
                platform: 'sensor',
                unique_id: '$deviceid-autodryremain',
                name: 'Auto dry remaining',
                icon: 'mdi:hair-dryer-outline',
                unit_of_measurement: '%',
                suggested_display_precision: 0,
                entity_category: 'diagnostic',
            }
            config['components']['autodry'] = compADry
            config['components']['autodryremain'] = compADryRem

            this.addField(config, {
                id: 0x20e,
                name: '',
                comp: 'autodry',
                writable: false,
                read_xform: (raw) => (raw ? 'ON' : 'OFF'),
            })

            this.addField(config, {
                id: 0x225,
                name: '',
                comp: 'autodryremain',
                writable: false,
            })
        }

        if (this.getIDUActionRunningTLVNum() != null) {
            this.addField(
                config,
                {
                    id: this.getIDUActionRunningTLVNum(),
                    name: 'action',
                    comp: 'climate',
                    read_callback: (val) => {
                        this.updateClimateAction()
                        return false
                    },
                },
                false,
            )
        }

        this.modeChangeHooks.push(() => {
            this.updateClimateAction()
        })

        // 0x21f - "display light" value is inverted in some devices,
        // but in some devices it is not - not shown in ThinQ app either

        if (this.filterLifeTime) {
            const filterUsed = {
                platform: 'sensor',
                unique_id: '$deviceid-filterused',
                state_topic: '$this/filterused',
                name: 'Filter used time',
                icon: 'mdi:air-filter',
                device_class: 'duration',
                unit_of_measurement: 'h',
                state_class: 'total_increasing',
                entity_category: 'diagnostic',
            }
            config['components']['filterused'] = filterUsed
            const filterLife = {
                platform: 'sensor',
                unique_id: '$deviceid-filterlife',
                state_topic: '$this/filterlife',
                name: 'Filter life time',
                icon: 'mdi:air-filter',
                device_class: 'duration',
                unit_of_measurement: 'h',
                entity_category: 'diagnostic',
            }
            config['components']['filterlife'] = filterLife
            const filterChanged = {
                platform: 'sensor',
                unique_id: '$deviceid-filterchangeddate',
                state_topic: '$this/filterchangeddate',
                name: 'Filter usage last reset',
                icon: 'mdi:calendar-refresh-outline',
                device_class: 'date',
                entity_category: 'diagnostic',
            }
            config['components']['changeddate'] = filterChanged

            const filterReset = {
                platform: 'button',
                unique_id: '$deviceid-filterreset',
                command_topic: '$this/filterreset/set',
                name: 'Reset filter usage',
                icon: 'mdi:calendar-refresh-outline',
                entity_category: 'diagnostic',
            }
            config['components']['filterreset'] = filterReset
            this.fields_by_ha['filterreset'] = {
                name: '',
                comp: '',
                write_xform: (val) => (val === 'PRESS' ? 1 : 0),
                write_callback: (val) => {
                    if (val === 1) {
                        this.filterDoReset = true
                        // do a query first to get the most recent pre-reset values
                        this.sendFilterQuery()
                    }
                    return false
                },
            }
        }

        // this value is reported as zero by multi-split units
        if (this.raw_clip_state[0x2b3]) {
            const energyCurrent = {
                platform: 'sensor',
                unique_id: '$deviceid-energy_current',
                state_topic: '$this/energy_current',
                name: 'Power',
                device_class: 'power',
                unit_of_measurement: 'W',
                state_class: 'measurement',
                suggested_display_precision: 0,
            }

            config['components']['energy_current'] = energyCurrent

            // The measurements reported by AC appear to be Watts, but they are not accurate in several aspects:
            // - the value is biased by +50
            // - idle consumption (around 4W) and the 4-way valve is not included
            // - fan modes' consumption appears to be approximated
            //
            // The formula below is expected to be within +/-10% of the actual power consumption. The discrepancy may
            // be highest in fan-only modes.
            this.addField(config, {
                id: 0x2b3,
                name: '',
                comp: 'energy_current',
                writable: false,
                read_xform: (raw) => Math.max(5, raw - 60),
            })
        }

        // These were separate select entities in the previous release.  An
        // empty discovery payload removes them before Climate receives the
        // integrated vertical and horizontal swing controls.
        this.HA.publishConfig(this.id, {
            ...config,
            components: {
                vertical_swing_mode: { platform: 'select' } as unknown as DeviceDiscovery['components'][string],
                horizontal_swing_mode: { platform: 'select' } as unknown as DeviceDiscovery['components'][string],
            },
        })
        this.setConfig(config)

        if (this.filterLifeTime) {
            this.publishFilterData()

            /*
             * Refresh only once a day since a query might do an EEPROM
             * write.
             */
            this.filterQueryTimer = setInterval(
                () => {
                    log('status', this.id, 'sending periodic filter data refresh query')
                    this.sendFilterQuery()
                },
                24 * 60 * 60 * 1000,
            )
        }

        this.query()
    }

    addTimerField(config: DeviceDiscovery, id: number, name: string, desc: string, icon: string, max: number) {
        const comp = {
            platform: 'number',
            unique_id: '$deviceid-' + name,
            name: desc,
            icon: icon,
            device_class: 'duration',
            unit_of_measurement: 'h',
            min: 0,
            max: max,
            step: 0.25,
            mode: 'slider',
        } as const
        config['components'][name] = comp

        /*
         * Upon setting this field the device starts counting down and
         * every minute sends the remaining time.
         */
        this.addField(config, {
            id: id,
            name: '',
            comp: name,
            read_xform: (raw) => Math.ceil(raw / 60 / 0.25) * 0.25,
            write_xform: (val) => Math.round(Number(val) * 60),
        })
    }

    addJetField(
        config: DeviceDiscovery,
        id: number,
        name: string,
        desc: string,
        icon: string,
        jetCool: boolean,
        jetHeat: boolean,
    ) {
        const descFull = jetCool && !jetHeat ? '파워 냉방' : jetHeat && !jetCool ? '파워 난방' : '파워 운전'

        const comp = {
            platform: 'switch',
            unique_id: '$deviceid-' + name,
            name: descFull,
            icon: icon,
        }
        config['components'][name] = comp

        this.addField(config, {
            id: id,
            name: '',
            comp: name,
            write_xform: (val) => {
                this.jetMode = val === 'ON'
                if (!this.jetMode) return 0

                /* ON */
                if (jetCool && this.getModeTLV() === 0) return 1
                if (jetHeat && this.getModeTLV() === 4) return 2
                return 0
            },
            read_xform: (raw) => {
                if (jetCool && this.getModeTLV() === 0 && raw == 1) return 'ON'
                if (jetHeat && this.getModeTLV() === 4 && raw == 2) return 'ON'
                return 'OFF'
            },
            read_callback: (val) => {
                // Ignore read value if not running
                const powerTLV = this.getPowerTLV()
                if (powerTLV === 0 || powerTLV == null) return false

                // Ignore read value if not in the right mode
                if (!((jetCool && this.getModeTLV() === 0) || (jetHeat && this.getModeTLV() === 4))) return false

                this.jetMode = val === 'ON'
                return true
            },
            write_callback: (val) => {
                /*
                 * Writing '1' in OFF state seem to immediately
                 * power on into the cooling mode, while writing
                 * '2' in the OFF state is ignored.
                 * Be consistent and only allow enabling Jet mode
                 * when running in the right mode.
                 */
                return (
                    this.getPowerTLV() !== 0 &&
                    ((jetCool && this.getModeTLV() === 0) || (jetHeat && this.getModeTLV() === 4))
                )
            },
        })

        /*
         * This value needs to be written at each power up in heat/cool mode,
         * but in a separate message.
         */
        this.modeChangeHooks.push(() => {
            this.setProperty(name + '-', this.jetMode ? 'ON' : 'OFF')
        })
    }

    addOptionalSensorField(
        config: DeviceDiscovery,
        ids: number | number[],
        name: string,
        desc: string,
        icon?: string,
        extra?: Record<string, unknown>,
        read_xform?: FieldDefinition['read_xform'],
    ) {
        if (typeof ids === 'number') {
            ids = [ids]
        }

        let id = ids.find(
            (val) =>
                this.raw_clip_state[val] != null &&
                (read_xform == null || read_xform(this.raw_clip_state[val]) != null),
        )
        if (id == null) return

        const comp = {
            icon: icon ?? undefined,
            platform: 'sensor',
            unique_id: '$deviceid-' + name,
            name: desc,
            entity_category: 'diagnostic',
            ...extra,
        }

        config['components'][name] = comp

        this.addField(config, {
            id: id,
            name: '',
            comp: name,
            writable: false,
            read_xform: read_xform,
        })
    }

    addOptionalSensorTempField(
        config: DeviceDiscovery,
        ids: number | number[],
        name: string,
        desc: string,
        icon?: string,
        read_xform?: FieldDefinition['read_xform'],
    ) {
        this.addOptionalSensorField(
            config,
            ids,
            name,
            desc,
            icon,
            {
                device_class: 'temperature',
                unit_of_measurement: '°C',
                state_class: 'measurement',
                suggested_display_precision: 2,
            },
            read_xform,
        )
    }

    addConfigSwitchField(config: DeviceDiscovery, id: number, name: string, desc: string, icon: string) {
        const comp = {
            platform: 'switch',
            unique_id: '$deviceid-' + name,
            name: desc,
            icon: icon,
            entity_category: 'config',
        }
        config['components'][name] = comp

        this.addField(config, {
            id: id,
            name: '',
            comp: name,
            write_xform: (val) => (val === 'ON' ? 1 : 0),
            read_xform: (raw) => (raw ? 'ON' : 'OFF'),
        })
    }

    addInvertedConfigSwitchField(config: DeviceDiscovery, id: number, name: string, desc: string, icon: string) {
        const comp = {
            platform: 'switch',
            unique_id: '$deviceid-' + name,
            name: desc,
            icon: icon,
            entity_category: 'config',
        }
        config['components'][name] = comp

        this.addField(config, {
            id: id,
            name: '',
            comp: name,
            write_xform: (val) => (val === 'ON' ? 0 : 1),
            read_xform: (raw) => (raw === 0 ? 'ON' : 'OFF'),
        })
    }

    addConfigSwitchFieldWithValues(
        config: DeviceDiscovery,
        id: number,
        name: string,
        desc: string,
        icon: string,
        onValue: number,
        offValue: number,
    ) {
        const comp = {
            platform: 'switch',
            unique_id: '$deviceid-' + name,
            name: desc,
            icon: icon,
            entity_category: 'config',
        }
        config['components'][name] = comp

        this.addField(config, {
            id: id,
            name: '',
            comp: name,
            write_xform: (val) => (val === 'ON' ? onValue : offValue),
            read_xform: (raw) => (raw === onValue ? 'ON' : 'OFF'),
        })
    }

    addModeDependentConfigSwitchField(
        config: DeviceDiscovery,
        id: number,
        name: string,
        desc: string,
        icon: string,
        field_name: 'airClean' | 'jetMode' | 'energySave',
        check_mode?: CheckMode,
    ) {
        const comp = {
            platform: 'switch',
            unique_id: '$deviceid-' + name,
            name: desc,
            icon: icon,
        }
        config['components'][name] = comp

        this.addField(config, {
            id: id,
            name: '',
            comp: name,
            write_xform: (val) => (val === 'ON' ? 1 : 0),
            read_xform: (raw) => (raw ? 'ON' : 'OFF'),
            read_callback: (val) => {
                // Ignore read value if not running
                const powerTLV = this.getPowerTLV()
                if (powerTLV === 0 || powerTLV == null) return false

                // Ignore read value if not in the right mode
                if (!!check_mode && !check_mode(this.getModeTLV())) return false

                this[field_name] = val === 'ON'
                return true
            },
            write_callback: (val) => {
                this[field_name] = val === 1

                // No need to write the value if not running in the right mode
                return this.getPowerTLV() !== 0 && (!check_mode || check_mode(this.getModeTLV()))
            },
        })

        if (!!check_mode) {
            this.modeChangeHooks.push(() => {
                this.setProperty(name + '-', this[field_name] ? 'ON' : 'OFF')
            })
        } else {
            this.powerChangeHooks.push(() => {
                if (this.getPowerTLV() === 0) return
                /*
                 * This value needs to be written at each power up,
                 * but in a separate message.
                 */
                this.setProperty(name + '-', this[field_name] ? 'ON' : 'OFF')
            })
        }
    }
}

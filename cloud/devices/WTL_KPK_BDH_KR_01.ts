import WTL_FXU_BDV_NA_01 from './WTL_FXU_BDV_NA_01'

const HEADER_LENGTH = 13
const KOREAN_STATE_LENGTH = 102
const KOREAN_STATE_PAIR_LENGTH = KOREAN_STATE_LENGTH * 2
const COMMAND_STATUS_PREFIX_LENGTH = 9

/**
 * Korean WashTower variant.
 *
 * It shares the first 95 state bytes and controls with WTL_FXU_BDV_NA_01,
 * but its full-state response uses message type 0x78 and advertises a
 * 102-byte 0xeb block. Seven model-specific bytes are inserted between the
 * washer and dryer sections, so the dryer section begins at byte 60.
 */
export default class Device extends WTL_FXU_BDV_NA_01 {
    protected override readonly dryerStateOffset = 60

    processAABB(buf: Buffer) {
        if (buf[0] === 0x36 && buf[1] === 0xe6) {
            if (buf.length === COMMAND_STATUS_PREFIX_LENGTH + KOREAN_STATE_LENGTH) {
                this.processStateBlock(buf.subarray(COMMAND_STATUS_PREFIX_LENGTH))
            }
            return
        }

        if (buf[0] === 0x36 && buf[1] === 0x0a && buf[10] === 0xeb && buf[3] === 0x78) {
            const stateLength = buf.readUInt16BE(11)
            const stateEnd = HEADER_LENGTH + stateLength
            if (stateLength === KOREAN_STATE_LENGTH && buf.length === stateEnd + 1) {
                this.processStateBlock(buf.subarray(HEADER_LENGTH, stateEnd))
            }
            return
        }

        if (buf[0] === 0x36 && buf[1] === 0x0a && buf[10] === 0xec && buf[3] === 0xde) {
            const stateLength = buf.readUInt16BE(11)
            const stateEnd = HEADER_LENGTH + stateLength
            if (stateLength === KOREAN_STATE_PAIR_LENGTH && buf.length === stateEnd + 1) {
                this.processStateBlock(buf.subarray(stateEnd - KOREAN_STATE_LENGTH, stateEnd))
            }
            return
        }

        super.processAABB(buf)
    }
}

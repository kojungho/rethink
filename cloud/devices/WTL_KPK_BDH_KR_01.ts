import WTL_FXU_BDV_NA_01 from './WTL_FXU_BDV_NA_01'

const HEADER_LENGTH = 13
const KOREAN_STATE_LENGTH = 102

/**
 * Korean WashTower variant.
 *
 * It shares the first 95 state bytes and controls with WTL_FXU_BDV_NA_01,
 * but its full-state response uses message type 0x78 and advertises a
 * 102-byte 0xeb block. The seven model-specific tail bytes are preserved for
 * future captures and intentionally ignored until their meaning is verified.
 */
export default class Device extends WTL_FXU_BDV_NA_01 {
    processAABB(buf: Buffer) {
        if (buf[0] === 0x36 && buf[1] === 0x0a && buf[3] === 0x78 && buf[10] === 0xeb) {
            const stateLength = buf.readUInt16BE(11)
            const stateEnd = HEADER_LENGTH + stateLength
            if (stateLength === KOREAN_STATE_LENGTH && buf.length === stateEnd + 1) {
                this.processStateBlock(buf.subarray(HEADER_LENGTH, stateEnd))
            }
            return
        }

        super.processAABB(buf)
    }
}

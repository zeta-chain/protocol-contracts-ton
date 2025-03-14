import { beginCell, Builder, Cell } from '@ton/core';
import * as ethers from 'ethers';

/**
 * stringHexToCell converts a hex-string to a TON Cell object encoded in "snake format"
 * @param input string e.g. `0xABC123...`
 * @returns TON Cell object
 * @see https://docs.ton.org/v3/guidelines/dapps/cookbook#writing-comments-long-strings-in-snake-format
 */
export function hexStringToCell(input: string): Cell {
    if (!ethers.isHexString(input)) {
        throw new Error('String should be a hex string (0x...)');
    }

    const buf = Buffer.from(input.substring(2), 'hex');

    let builder = beginCell();

    writeBuffer(buf, builder);

    return builder.endCell();
}

// https://github.com/ton-org/ton-core/blob/4eaced536d0a89f9374d9772884c7b52bddb68ba/src/boc/utils/strings.ts#L42
function writeBuffer(src: Buffer, builder: Builder) {
    if (src.length === 0) {
        return;
    }

    let bytes = Math.floor(builder.availableBits / 8);

    if (src.length > bytes) {
        let a = src.subarray(0, bytes);
        let t = src.subarray(bytes);
        builder = builder.storeBuffer(a);
        let bb = beginCell();
        writeBuffer(t, bb);
        builder = builder.storeRef(bb.endCell());
    } else {
        builder = builder.storeBuffer(src);
    }
}

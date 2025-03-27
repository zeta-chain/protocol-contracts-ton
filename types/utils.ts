import { beginCell, Builder, Cell, Slice } from '@ton/core';
import { ethers } from 'ethers';

/**
 * Converts an EVM address to a TVM slice
 * @param address - EVM address e.g `0x1234567890123456789012345678901234567890`
 * @returns Slice
 */
export function evmAddressToSlice(address: string): Slice {
    if (address.length !== 42) {
        throw new Error(`Invalid EVM address: ${address}`);
    }

    // Remove '0x' prefix
    const hexString = address.slice(2);

    // Convert to Buffer
    const buffer = Buffer.from(hexString, 'hex');
    if (buffer.length !== 20) {
        throw new Error(`Invalid Buffer length: ${buffer.length}`);
    }

    return beginCell().storeBuffer(buffer).asSlice();
}

/**
 * Converts a Buffer to a hex string
 * @param b - Buffer
 * @returns string (`0x...`)
 */
export function bufferToHexString(b: Buffer): string {
    const hex = b.toString('hex');

    return `0x${hex}`;
}

/**
 * Converts a Slice to a hex string
 * @param s - Slice
 * @param bytes - Number of bytes to convert
 * @returns string (`0x...`)
 */
export function sliceToHexString(s: Slice, bytes: number): string {
    return bufferToHexString(s.loadBuffer(bytes));
}

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
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
 * Converts a Slice to a hex string (0x...)
 * @param s - Slice
 * @returns string (`0x...`)
 */
export function sliceToHexString(s: Slice): string {
    return bufferToHexString(readBuffer(s));
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

// https://github.com/ton-org/ton-core/blob/4eaced536d0a89f9374d9772884c7b52bddb68ba/src/boc/utils/strings.ts#L13
export function readBuffer(slice: Slice) {
    // Check consistency
    if (slice.remainingBits % 8 !== 0) {
        throw new Error(`Invalid string length: ${slice.remainingBits}`);
    }

    if (slice.remainingRefs !== 0 && slice.remainingRefs !== 1) {
        throw new Error(`invalid number of refs: ${slice.remainingRefs}`);
    }

    // Read string
    let res: Buffer;

    if (slice.remainingBits === 0) {
        res = Buffer.alloc(0);
    } else {
        res = slice.loadBuffer(slice.remainingBits / 8);
    }

    // Read tail
    if (slice.remainingRefs === 1) {
        const tail = slice.loadRef().beginParse();
        res = Buffer.concat([res, readBuffer(tail)]);
    }

    return res;
}

// returns a string with a decimal point
export function formatCoin(coins: bigint): string {
    const divisor = 1_000_000_000n;
    const tons = coins / divisor;
    const fractional = coins % divisor;

    if (fractional === 0n) {
        return String(tons);
    }

    // Ensure the fractional part is always 9 digits by padding with leading zeros if necessary
    let fractionalStr = fractional.toString().padStart(9, '0');
    fractionalStr = trimSuffix(fractionalStr, '0');

    return `${tons.toString()}.${fractionalStr}`;
}

function trimSuffix(str: string, suffix: string): string {
    while (str.endsWith(suffix)) {
        str = str.slice(0, -suffix.length);
    }

    return str;
}

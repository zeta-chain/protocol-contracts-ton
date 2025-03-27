import { beginCell, Slice } from '@ton/core';

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

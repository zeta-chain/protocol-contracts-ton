import { beginCell, Slice, Transaction } from '@ton/core';

export function evmAddressToSlice(address: string): Slice {
    if (address.length !== 42) {
        throw new Error(`Invalid EVM address: ${address}`);
    }

    // Remove the '0x' prefix
    const hexString = address.slice(2);

    // Convert to Buffer
    const buffer = Buffer.from(hexString, 'hex');
    if (buffer.length !== 20) {
        throw new Error(`Invalid Buffer length: ${buffer.length}`);
    }

    return beginCell().storeBuffer(buffer).asSlice();
}

// loads Slice to hex string `0x...`
export function loadHexStringFromSlice(s: Slice, bytes: number): string {
    return loadHexStringFromBuffer(s.loadBuffer(bytes));
}

export function loadHexStringFromBuffer(b: Buffer): string {
    const hex = b.toString('hex');

    return `0x${hex}`;
}

export function logGasUsage(expect: jest.Expect, tx: Transaction): void {
    const testName = expect.getState().currentTestName;
    console.log(`test "${testName}": gas used`, formatCoin(tx.totalFees.coins));
}

// returns a string with a decimal point
export function formatCoin(coins: bigint): string {
    const divisor = 1_000_000_000n;

    const tons = coins / divisor;
    const fractional = coins % divisor;

    // Ensure the fractional part is always 9 digits by padding with leading zeros if necessary
    const fractionalStr = fractional.toString().padStart(9, '0');

    return `${tons.toString()}.${fractionalStr} TON`;
}

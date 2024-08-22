import { beginCell, Slice, Transaction } from '@ton/core';
import { findTransaction, FlatTransactionComparable } from '@ton/test-utils/dist/test/transaction';

export function expectTX(transactions: Transaction[], cmp: FlatTransactionComparable): Transaction {
    expect(transactions).toHaveTransaction(cmp);

    const tx = findTransaction(transactions, cmp);
    expect(tx).toBeDefined();

    return tx!;
}

export function evmAddressToSlice(address: string): Slice {
    expect(address.length).toEqual(42);

    // Remove the '0x' prefix
    const hexString = address.slice(2);

    // Convert to Buffer
    const buffer = Buffer.from(hexString, 'hex');
    expect(buffer.length).toEqual(20);

    return beginCell().storeBuffer(buffer).asSlice();
}

// loads Slice to hex string `0x...`
export function loadHexString(s: Slice, bytes: number): string {
    const b = s.loadBuffer(bytes);
    const hex = b.toString('hex');

    return `0x${hex}`;
}

export function logGasUsage(tx: Transaction): void {
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

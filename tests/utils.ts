import { beginCell, Cell, Slice, Transaction } from '@ton/core';
import { Wallet } from 'ethers';

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

/**
 * Signs a cell with secp256k1 signature into a Slice (65 bytes)
 * @param signer
 * @param cell
 * @param log
 */
export function signCellECDSA(signer: Wallet, cell: Cell, log: boolean = false): Slice {
    const hash = cell.hash();
    const sig = signer.signingKey.sign(hash);

    // https://docs.ton.org/learn/tvm-instructions/instructions
    //
    // `ECRECOVER` Recovers public key from signature...
    // Takes 32-byte hash as uint256 hash; 65-byte signature as uint8 v and uint256 r, s.
    const [v, r, s] = [sig.v, sig.r, sig.s];

    const bigV = BigInt(v);
    const bigR = BigInt(r);
    const bigS = BigInt(s);

    if (log) {
        console.log('signCellECDSA', { bigV, bigR, bigS });
    }

    return beginCell().storeUint(bigV, 8).storeUint(bigR, 256).storeUint(bigS, 256).asSlice();
}

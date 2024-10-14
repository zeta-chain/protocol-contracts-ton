import { beginCell, Cell, Message, Slice, Transaction } from '@ton/core';
import { Wallet } from 'ethers';
import { compileFunc } from '@ton-community/func-js';
import { TransactionDescriptionGeneric } from '@ton/core/src/types/TransactionDescription';

export interface TxFeeReport {
    txType: string;

    totalFees: bigint;
    storageFees: bigint;
    computeFees: bigint;
    gasUsed: bigint;
    actionFees: bigint;
    fwdFees: bigint;

    inMessage: MsgFeeReport;
    outMessages: Array<MsgFeeReport>;
}

export interface MsgFeeReport {
    type: string;

    coins: bigint;

    // internal message
    forwardFee: bigint;

    // incoming external message
    importFee: bigint;
}

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

export function reportTXFees(tx: Transaction): TxFeeReport {
    const desc = tx.description as TransactionDescriptionGeneric;

    const totalFees = tx.totalFees.coins;

    const storageFees = desc.storagePhase?.storageFeesCollected || 0n;

    const compute = desc.computePhase;
    const [computeFees, gasUsed] =
        compute.type === 'vm' ? [compute.gasFees, compute.gasUsed] : [0n, 0n];

    const actionFees = desc.actionPhase?.totalActionFees || 0n;
    const fwdFees = desc.actionPhase?.totalFwdFees || 0n;

    return {
        txType: tx.description.type,

        totalFees,
        storageFees,
        computeFees,
        gasUsed,

        actionFees,
        fwdFees,

        inMessage: reportMsgFees(tx.inMessage!),
        outMessages: tx.outMessages.values().map(reportMsgFees),
    };
}

function reportMsgFees(msg: Message): MsgFeeReport {
    const type = msg.info.type;

    if (type === 'internal') {
        return {
            type,
            coins: msg.info.value.coins,
            forwardFee: msg.info.forwardFee,
            importFee: 0n,
        };
    }

    if (type === 'external-in') {
        return { type, coins: 0n, forwardFee: 0n, importFee: msg.info.importFee };
    }

    // external-out
    return { type, coins: 0n, forwardFee: 0n, importFee: 0n };
}

// returns a string with a decimal point
export function formatCoin(coins: bigint): string {
    const divisor = 1_000_000_000n;
    const tons = coins / divisor;
    const fractional = coins % divisor;

    if (fractional === 0n) {
        return `${tons} ton`;
    }

    // Ensure the fractional part is always 9 digits by padding with leading zeros if necessary
    let fractionalStr = fractional.toString().padStart(9, '0');
    fractionalStr = trimSuffix(fractionalStr, '0');

    return `${tons.toString()}.${fractionalStr} ton`;
}

function trimSuffix(str: string, suffix: string): string {
    while (str.endsWith(suffix)) {
        str = str.slice(0, -suffix.length);
    }

    return str;
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

/**
 * Compiles the given FunC code and returns the resulting cell
 * @see https://github.com/ton-community/func-js
 * @param code
 */
export async function compileFuncInline(code: string): Promise<Cell> {
    // We can embed 'stdlib.fc' in the future
    const result = await compileFunc({
        targets: ['main.fc'],
        sources: { 'main.fc': code },
    });

    expect(result.status).toBe('ok');

    // @ts-ignore
    // Bag of Cells
    const boc = result.codeBoc as string;

    const cells = Cell.fromBoc(Buffer.from(boc, 'base64'));
    expect(cells.length).toBe(1);

    return cells[0];
}

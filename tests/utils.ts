import { beginCell, Cell, Message, Slice, Transaction } from '@ton/core';
import { Wallet } from 'ethers';
import { compileFunc } from '@ton-community/func-js';
import { TransactionDescriptionGeneric } from '@ton/core/src/types/TransactionDescription';
import { cellFromEncoded } from '../types';

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

    return cellFromEncoded(boc);
}

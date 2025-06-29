import { Address, beginCell, Cell, TupleReader } from '@ton/core';
import { bufferToHexString, evmAddressToSlice } from './utils';

// copied from `gateway.fc`
export enum GatewayOp {
    Donate = 100,
    Deposit = 101,
    DepositAndCall = 102,
    Call = 103,

    Withdraw = 200,
    IncreaseSeqno = 205,

    SetDepositsEnabled = 201,
    UpdateTSS = 202,
    UpdateCode = 203,
    UpdateAuthority = 204,
    ResetSeqno = 206,
}

// copied from `errors.fc`
export enum GatewayError {
    NoIntent = 101,
    InvalidCallData = 104,
    InsufficientValue = 106,
    InvalidSignature = 108,
    InvalidSeqno = 109,
    DepositsDisabled = 110,
    InvalidAuthority = 111,
    InvalidTVMRecipient = 112,
}

export type GatewayConfig = {
    depositsEnabled: boolean;
    totalLocked: bigint;
    seqno: number;
    tss: string;
    authority: Address;
};

// Initial state of the contract during deployment
export function gatewayConfigToCell(config: GatewayConfig): Cell {
    if (config.seqno < 0) {
        throw new Error('Seqno must be non-negative');
    }

    if (config.totalLocked < 0) {
        throw new Error('Total locked must be non-negative');
    }

    const tss = evmAddressToSlice(config.tss);

    return beginCell()
        .storeUint(config.depositsEnabled ? 1 : 0, 1) // deposits_enabled
        .storeCoins(config.totalLocked) // total_locked
        .storeUint(config.seqno, 32) // seqno
        .storeSlice(tss) // tss_address
        .storeAddress(config.authority) // authority_address
        .endCell();
}

export type GatewayState = {
    depositsEnabled: boolean;
    valueLocked: bigint;
    tss: string;
    authority: Address;
};

// result of 'query_state' getter
export function gatewayStateFromStack(stack: TupleReader): GatewayState {
    return {
        depositsEnabled: stack.readBoolean(),
        valueLocked: stack.readBigNumber(),
        tss: bufferToHexString(stack.readBuffer()),
        authority: stack.readAddress(),
    };
}

// outbound message that is sent from the Gateway to "void"
// Note that is doesn't contain call data because it would use more gas.
// Calldata should be parsed from the incoming internal message of the tx.
export type DepositLog = {
    amount: bigint;
    depositFee: bigint;
};

export function depositLogFromCell(body: Cell): DepositLog {
    const cs = body.beginParse();

    const amount = cs.loadCoins();
    const depositFee = cs.loadCoins();

    return { amount, depositFee };
}

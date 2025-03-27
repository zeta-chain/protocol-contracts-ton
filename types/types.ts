import { Address, beginCell, Cell } from '@ton/core';
import { evmAddressToSlice } from './utils';

// copied from `gateway.fc`
export enum GatewayOp {
    Donate = 100,
    Deposit = 101,
    DepositAndCall = 102,

    Withdraw = 200,
    SetDepositsEnabled = 201,
    UpdateTSS = 202,
    UpdateCode = 203,
    UpdateAuthority = 204,
}

// copied from `errors.fc`
export enum GatewayError {
    NoIntent = 101,
    InvalidCallData = 104,
    InsufficientValue = 106,
    InvalidSignature = 108,
    DepositsDisabled = 110,
    InvalidAuthority = 111,
    InvalidTVMRecipient = 112,
}

export type GatewayConfig = {
    depositsEnabled: boolean;
    tss: string;
    authority: Address;
};

export type GatewayState = {
    depositsEnabled: boolean;
    valueLocked: bigint;
    tss: string;
    authority: Address;
};

// outbound message that is send from the Gateway to "void"
// Note that is doesn't contain call data because it would use more gas.
// Calldata should be parsed from the incoming internal message of the tx.
export type DepositLog = {
    amount: bigint;
    depositFee: bigint;
};

// Initial state of the contract during deployment
export function gatewayConfigToCell(config: GatewayConfig): Cell {
    const tss = evmAddressToSlice(config.tss);

    return beginCell()
        .storeUint(config.depositsEnabled ? 1 : 0, 1) // deposits_enabled
        .storeCoins(0) // total_locked
        .storeUint(0, 32) // seqno
        .storeSlice(tss) // tss_address
        .storeAddress(config.authority) // authority_address
        .endCell();
}

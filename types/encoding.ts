import { Address, beginCell, Builder, Cell, TupleReader } from '@ton/core';
import { GatewayOp, GatewayState } from './types';
import { bufferToHexString, evmAddressToSlice, sliceToHexString } from './utils';

// op code, query id (0)
function newIntent(op: GatewayOp): Builder {
    return beginCell().storeUint(op, 32).storeUint(0, 64);
}

/**
 * Creates a donation body for the Gateway contract
 * @returns
 */
export function donationBody(): Cell {
    return newIntent(GatewayOp.Donate).endCell();
}

/**
 * Creates a deposit body for the Gateway contract
 * @param zevmRecipient - EVM recipient address
 * @returns Cell
 */
export function depositBody(zevmRecipient: string | bigint): Cell {
    // accept bigInt or hex string
    if (typeof zevmRecipient === 'string') {
        zevmRecipient = BigInt(zevmRecipient);
    }

    return newIntent(GatewayOp.Deposit)
        .storeUint(zevmRecipient, 160) // 20 bytes
        .endCell();
}

/**
 * Creates a deposit and call body for the Gateway contract
 * @param zevmRecipient - EVM recipient address
 * @param callData - Call data
 * @returns Cell
 */
export function depositAndCallBody(zevmRecipient: string | bigint, callData: Cell): Cell {
    // accept bigInt or hex string
    if (typeof zevmRecipient === 'string') {
        zevmRecipient = BigInt(zevmRecipient);
    }

    return newIntent(GatewayOp.DepositAndCall)
        .storeUint(zevmRecipient, 160) // 20 bytes
        .storeRef(callData)
        .endCell();
}

export function depositsEnabledBody(enabled: boolean): Cell {
    return newIntent(GatewayOp.SetDepositsEnabled).storeBit(enabled).endCell();
}

export function updateTSSBody(newTSS: string): Cell {
    const address = evmAddressToSlice(newTSS);

    return newIntent(GatewayOp.UpdateTSS).storeSlice(address).endCell();
}

export function updateCodeBody(code: Cell): Cell {
    return newIntent(GatewayOp.UpdateCode).storeRef(code).endCell();
}

export function updateAuthorityBody(authority: Address): Cell {
    return newIntent(GatewayOp.UpdateAuthority).storeAddress(authority).endCell();
}

export function withdrawBody(seqno: number, recipient: Address, amount: bigint): Cell {
    return beginCell()
        .storeUint(GatewayOp.Withdraw, 32)
        .storeAddress(recipient)
        .storeCoins(amount)
        .storeUint(seqno, 32)
        .endCell();
}

// result of 'query_state' getter
export function decodeGatewayState(stack: TupleReader): GatewayState {
    return {
        depositsEnabled: stack.readBoolean(),
        valueLocked: stack.readBigNumber(),
        tss: bufferToHexString(stack.readBuffer()),
        authority: stack.readAddress(),
    };
}

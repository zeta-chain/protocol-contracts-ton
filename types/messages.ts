import { Address, beginCell, Builder, Cell, Slice } from '@ton/core';
import { GatewayOp } from './types';
import { evmAddressToSlice } from './utils';

// op code, query id (0)
function newIntent(op: GatewayOp): Builder {
    return beginCell().storeUint(op, 32).storeUint(0, 64);
}

/**
 * Creates a donation body for the Gateway contract
 * @returns
 */
export function messageDonation(): Cell {
    return newIntent(GatewayOp.Donate).endCell();
}

/**
 * Creates a deposit body for the Gateway contract
 * @param zevmRecipient - EVM recipient address
 * @returns Cell
 */
export function messageDeposit(zevmRecipient: string | bigint): Cell {
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
export function messageDepositAndCall(zevmRecipient: string | bigint, callData: Cell): Cell {
    // accept bigInt or hex string
    if (typeof zevmRecipient === 'string') {
        zevmRecipient = BigInt(zevmRecipient);
    }

    return newIntent(GatewayOp.DepositAndCall)
        .storeUint(zevmRecipient, 160) // 20 bytes
        .storeRef(callData)
        .endCell();
}

export function messageDepositsEnabled(enabled: boolean): Cell {
    return newIntent(GatewayOp.SetDepositsEnabled).storeBit(enabled).endCell();
}

export function messageUpdateTSS(newTSS: string): Cell {
    const address = evmAddressToSlice(newTSS);

    return newIntent(GatewayOp.UpdateTSS).storeSlice(address).endCell();
}

export function messageUpdateCode(code: Cell): Cell {
    return newIntent(GatewayOp.UpdateCode).storeRef(code).endCell();
}

export function messageUpdateAuthority(authority: Address): Cell {
    return newIntent(GatewayOp.UpdateAuthority).storeAddress(authority).endCell();
}

export function messageWithdraw(seqno: number, recipient: Address, amount: bigint): Cell {
    return beginCell()
        .storeUint(GatewayOp.Withdraw, 32)
        .storeAddress(recipient)
        .storeCoins(amount)
        .storeUint(seqno, 32)
        .endCell();
}

/**
 * Creates an external message for the Gateway contract. Used for broadcasting withdrawals.
 * In reality, this part is implemented in Zeta via TSS ceremony. However this is useful in
 * local/testing environment, where TSS can be mocked as simple ECDSA private key
 * @param signature - ECDSA Signature as ton/core Slice of (V|R|S)
 * @param payload - Payload
 * @returns Cell
 */
export function messageExternal(signature: Slice, payload: Cell): Cell {
    // 1b, 32b, 32b
    const [v, r, s] = [signature.loadBits(8), signature.loadBits(256), signature.loadBits(256)];

    return beginCell().storeBits(v).storeBits(r).storeBits(s).storeRef(payload).endCell();
}

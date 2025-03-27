import { Address, beginCell, Builder, Cell, Slice, TupleReader } from '@ton/core';
import { DepositLog, GatewayOp, GatewayState } from './types';
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

/**
 * Creates an external message for the Gateway contract. Used for broadcasting withdrawals.
 * In reality, this part is implemented in Zeta via TSS ceremony. However this is useful in
 * local/testing environment, where TSS can be mocked as simple ECDSA private key
 * @param signature - ECDSA Signature as ton/core Slice of (V|R|S)
 * @param payload - Payload
 * @returns Cell
 */
export function externalMessage(signature: Slice, payload: Cell): Cell {
    // 1b, 32b, 32b
    const [v, r, s] = [signature.loadBits(8), signature.loadBits(256), signature.loadBits(256)];

    return beginCell().storeBits(v).storeBits(r).storeBits(s).storeRef(payload).endCell();
}

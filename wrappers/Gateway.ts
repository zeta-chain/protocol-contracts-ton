import {
    Address,
    beginCell,
    Builder,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
    TupleItemInt,
    Slice,
} from '@ton/core';
import { Wallet as EVMWallet } from 'ethers';

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

export class Gateway implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Gateway(address);
    }

    static createFromConfig(config: GatewayConfig, code: Cell, workchain = 0) {
        const data = gatewayConfigToCell(config);
        const init = { code, data };
        return new Gateway(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendDeposit(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        zevmRecipient: string | bigint,
    ) {
        // accept bigInt or hex string
        if (typeof zevmRecipient === 'string') {
            zevmRecipient = BigInt(zevmRecipient);
        }

        const body = beginCell()
            .storeUint(GatewayOp.Deposit, 32) // op code
            .storeUint(0, 64) // query id
            .storeUint(zevmRecipient, 160) // 20 bytes
            .endCell();

        const sendMode = SendMode.PAY_GAS_SEPARATELY;

        await provider.internal(via, { value, sendMode, body });
    }

    async sendDepositAndCall(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        zevmRecipient: string | bigint,
        callData: Cell,
    ) {
        // accept bigInt or hex string
        if (typeof zevmRecipient === 'string') {
            zevmRecipient = BigInt(zevmRecipient);
        }

        const body = newIntent(GatewayOp.DepositAndCall)
            .storeUint(zevmRecipient, 160) // 20 bytes
            .storeRef(callData)
            .endCell();

        const sendMode = SendMode.PAY_GAS_SEPARATELY;

        await provider.internal(via, { value, sendMode, body });
    }

    async sendDonation(provider: ContractProvider, via: Sender, value: bigint) {
        let body = beginCell()
            .storeUint(GatewayOp.Donate, 32) // op code
            .storeUint(0, 64) // query id
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
        });
    }

    async sendEnableDeposits(provider: ContractProvider, via: Sender, enabled: boolean) {
        const body = newIntent(GatewayOp.SetDepositsEnabled).storeBit(enabled).endCell();

        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateTSS(provider: ContractProvider, via: Sender, newTSS: string) {
        const body = newIntent(GatewayOp.UpdateTSS).storeSlice(evmAddressToSlice(newTSS)).endCell();

        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateCode(provider: ContractProvider, via: Sender, code: Cell) {
        const body = newIntent(GatewayOp.UpdateCode).storeRef(code).endCell();

        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateAuthority(provider: ContractProvider, via: Sender, authority: Address) {
        const body = newIntent(GatewayOp.UpdateAuthority).storeAddress(authority).endCell();

        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendAuthorityCommand(provider: ContractProvider, via: Sender, body: Cell) {
        await provider.internal(via, {
            value: toNano('0.1'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
        });
    }

    async sendWithdraw(
        provider: ContractProvider,
        signer: EVMWallet,
        recipient: Address,
        amount: bigint,
    ) {
        const seqno = await this.getSeqno(provider);
        const payload = beginCell()
            .storeUint(GatewayOp.Withdraw, 32)
            .storeAddress(recipient)
            .storeCoins(amount)
            .storeUint(seqno, 32)
            .endCell();

        return await this.sendTSSCommand(provider, signer, payload);
    }

    /**
     * Sign external message using ECDSA private TSS key and send it to the contract
     *
     * @param provider
     * @param signer
     * @param payload
     */
    async sendTSSCommand(provider: ContractProvider, signer: EVMWallet, payload: Cell) {
        const signature = signCellECDSA(signer, payload);

        // SHA-256
        const hash = payload.hash();
        if (hash.byteLength != 32) {
            throw new Error(`Invalid hash length (got ${hash.byteLength}, want 32)`);
        }

        const message = beginCell()
            .storeBits(signature.loadBits(8)) // v
            .storeBits(signature.loadBits(256)) // r
            .storeBits(signature.loadBits(256)) // s
            .storeRef(payload)
            .endCell();

        await provider.external(message);
    }

    async getBalance(provider: ContractProvider): Promise<bigint> {
        const state = await provider.getState();

        return state.balance;
    }

    async getGatewayState(provider: ContractProvider): Promise<GatewayState> {
        const response = await provider.get('query_state', []);

        const depositsEnabled = response.stack.readBoolean();
        const valueLocked = response.stack.readBigNumber();
        const tssAddress = loadHexStringFromBuffer(response.stack.readBuffer());
        const authorityAddress = response.stack.readAddress();

        return {
            depositsEnabled,
            valueLocked,
            tss: tssAddress,
            authority: authorityAddress,
        };
    }

    async getSeqno(provider: ContractProvider): Promise<number> {
        const response = await provider.get('seqno', []);

        return response.stack.readNumber();
    }

    async getTxFee(provider: ContractProvider, op: GatewayOp): Promise<bigint> {
        const v = BigInt(op.valueOf());
        const bigOp: TupleItemInt = { type: 'int', value: v };

        const response = await provider.get('calculate_gas_fee', [bigOp]);

        return response.stack.readBigNumber();
    }
}

export interface DepositLog {
    amount: bigint;
    depositFee: bigint;
}

export function parseDepositLog(body: Cell): DepositLog {
    const cs = body.beginParse();

    const amount = cs.loadCoins();
    const depositFee = cs.loadCoins();

    return { amount, depositFee };
}

function newIntent(op: GatewayOp): Builder {
    // op code, query id
    return beginCell().storeUint(op, 32).storeUint(0, 64);
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

/**
 * Signs a cell with secp256k1 signature into a Slice (65 bytes)
 * @param signer
 * @param cell
 * @param log
 */
export function signCellECDSA(signer: EVMWallet, cell: Cell, log: boolean = false): Slice {
    const hash = cell.hash();
    const sig = signer.signingKey.sign(hash);

    // https://docs.ton.org/learn/tvm-instructions/instructions
    //
    // `ECRECOVER` Recovers public key from signature...
    // Takes 32-byte hash as uint256 hash; 65-byte signature as uint8 v and uint256 r, s.
    const [v, r, s] = [Number(sig.v), BigInt(sig.r), BigInt(sig.s)];

    if (log) {
        console.log('signCellECDSA', { v, r, s });
    }

    return beginCell().storeUint(v, 8).storeUint(r, 256).storeUint(s, 256).asSlice();
}

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
import * as types from '../types';
import * as ethers from 'ethers';

export class Gateway implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Gateway(address);
    }

    static createFromConfig(config: types.GatewayConfig, code: Cell, workchain = 0) {
        const data = types.gatewayConfigToCell(config);
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
        const body = types.depositBody(zevmRecipient);
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
        const body = types.depositAndCallBody(zevmRecipient, callData);
        const sendMode = SendMode.PAY_GAS_SEPARATELY;

        await provider.internal(via, { value, sendMode, body });
    }

    async sendDonation(provider: ContractProvider, via: Sender, value: bigint) {
        const body = types.donationBody();
        const sendMode = SendMode.PAY_GAS_SEPARATELY;

        await provider.internal(via, { value, sendMode, body });
    }

    async sendEnableDeposits(provider: ContractProvider, via: Sender, enabled: boolean) {
        const body = types.depositsEnabledBody(enabled);
        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateTSS(provider: ContractProvider, via: Sender, newTSS: string) {
        const body = types.updateTSSBody(newTSS);
        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateCode(provider: ContractProvider, via: Sender, code: Cell) {
        const body = types.updateCodeBody(code);
        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateAuthority(provider: ContractProvider, via: Sender, authority: Address) {
        const body = types.updateAuthorityBody(authority);
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
        signer: ethers.Wallet,
        recipient: Address,
        amount: bigint,
    ) {
        const seqno = await this.getSeqno(provider);
        const body = types.withdrawBody(seqno, recipient, amount);

        return await this.sendTSSCommand(provider, signer, body);
    }

    /**
     * Sign external message using ECDSA private TSS key and send it to the contract
     *
     * @param provider
     * @param signer
     * @param payload
     */
    async sendTSSCommand(provider: ContractProvider, signer: ethers.Wallet, payload: Cell) {
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

    async getGatewayState(provider: ContractProvider): Promise<types.GatewayState> {
        const response = await provider.get('query_state', []);

        return types.decodeGatewayState(response.stack);
    }

    async getSeqno(provider: ContractProvider): Promise<number> {
        const response = await provider.get('seqno', []);

        return response.stack.readNumber();
    }

    async getTxFee(provider: ContractProvider, op: types.GatewayOp): Promise<bigint> {
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

/**
 * Signs a cell with secp256k1 signature into a Slice (65 bytes)
 * @param signer
 * @param cell
 * @param log
 */
export function signCellECDSA(signer: ethers.Wallet, cell: Cell, log: boolean = false): Slice {
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

import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    Slice,
} from '@ton/core';
import { evmAddressToSlice, loadHexStringFromBuffer, signCellECDSA } from '../tests/utils';
import { Wallet } from 'ethers';

// copied from `gateway.fc`
export enum GatewayOp {
    Deposit = 100,
    Donate = 101,

    Withdraw = 200,
    SetDepositsEnabled = 201,
    UpdateTSS = 202,
}

// copied from `errors.fc`
export enum GatewayError {
    NoIntent = 101,
    InvalidSignature = 108,
    DepositsDisabled = 110,
}

export type GatewayConfig = {
    depositsEnabled: boolean;
    tssAddress: string;
};

export type AdminCommand = {
    op: number;
    signature: Slice;
    payload: Cell;
};

// Initial state of the contract during deployment
export function gatewayConfigToCell(config: GatewayConfig): Cell {
    const tss = evmAddressToSlice(config.tssAddress);

    return beginCell()
        .storeUint(config.depositsEnabled ? 1 : 0, 1) // deposits_enabled
        .storeCoins(0) // total_locked
        .storeCoins(0) // fees
        .storeUint(0, 32) // seqno
        .storeSlice(tss) // tss_address
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

    async sendDeposit(provider: ContractProvider, via: Sender, value: bigint, memo: Slice | null) {
        let body = beginCell()
            .storeUint(GatewayOp.Deposit, 32) // op code
            .storeUint(0, 64); // query id

        if (memo) {
            body = body.storeRef(beginCell().storeSlice(memo).endCell());
        }

        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: body.endCell(),
        });
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

    async sendEnableDeposits(provider: ContractProvider, signer: Wallet, enabled: boolean) {
        const nextSeqno = await this.getNextSeqno(provider);
        const payload = beginCell().storeBit(enabled).storeUint(nextSeqno, 32).endCell();

        return await this.signAndSendAdminCommand(
            provider,
            signer,
            GatewayOp.SetDepositsEnabled,
            payload,
        );
    }

    async sendUpdateTSS(provider: ContractProvider, signer: Wallet, newTSS: string) {
        const nextSeqno = await this.getNextSeqno(provider);
        const payload = beginCell()
            .storeSlice(evmAddressToSlice(newTSS))
            .storeUint(nextSeqno, 32)
            .endCell();

        return await this.signAndSendAdminCommand(provider, signer, GatewayOp.UpdateTSS, payload);
    }

    /**
     * Sign external message using ECDSA private key and send it to the contract
     *
     * @param provider
     * @param signer
     * @param op
     * @param payload
     */
    async signAndSendAdminCommand(
        provider: ContractProvider,
        signer: Wallet,
        op: number,
        payload: Cell,
    ) {
        const signature = signCellECDSA(signer, payload);

        return await this.sendAdminCommand(provider, { op, payload, signature });
    }

    /**
     * Send an admin command to the contract as an external message
     * @param provider
     * @param cmd
     */
    async sendAdminCommand(provider: ContractProvider, cmd: AdminCommand) {
        // SHA-256
        const hash = cmd.payload.hash();
        if (hash.byteLength != 32) {
            throw new Error(`Invalid hash length (got ${hash.byteLength}, want 32)`);
        }

        const message = beginCell()
            .storeUint(cmd.op, 32)
            .storeBits(cmd.signature.loadBits(8)) // v
            .storeBits(cmd.signature.loadBits(256)) // r
            .storeBits(cmd.signature.loadBits(256)) // s
            .storeBuffer(hash)
            .storeRef(cmd.payload)
            .endCell();

        await provider.external(message);
    }

    async getBalance(provider: ContractProvider): Promise<bigint> {
        const state = await provider.getState();

        return state.balance;
    }

    async getQueryState(provider: ContractProvider): Promise<[boolean, bigint, string]> {
        const response = await provider.get('query_state', []);

        const depositsEnabled = response.stack.readBoolean();
        const valueLocked = response.stack.readBigNumber();
        const tssAddress = loadHexStringFromBuffer(response.stack.readBuffer());

        return [depositsEnabled, valueLocked, tssAddress];
    }

    async getSeqno(provider: ContractProvider): Promise<number> {
        const response = await provider.get('seqno', []);

        return response.stack.readNumber();
    }

    private async getNextSeqno(provider: ContractProvider): Promise<number> {
        return (await this.getSeqno(provider)) + 1;
    }
}

export type DepositLog = {
    op: number;
    queryId: number;
    sender: Address;
    amount: bigint;
    memo: Cell;
};

export function parseDepositLog(body: Cell): DepositLog {
    const cs = body.beginParse();

    const op = cs.loadUint(32);
    const queryId = cs.loadUint(64);
    const sender = cs.loadAddress();
    const amount = cs.loadCoins();
    const memo = cs.loadRef();

    return { op, queryId, sender, amount, memo };
}

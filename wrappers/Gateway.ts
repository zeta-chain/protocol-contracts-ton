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
import * as crypto from '../crypto/ecdsa';
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
        const body = types.messageDeposit(zevmRecipient);
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
        const body = types.messageDepositAndCall(zevmRecipient, callData);
        const sendMode = SendMode.PAY_GAS_SEPARATELY;

        await provider.internal(via, { value, sendMode, body });
    }

    async sendDonation(provider: ContractProvider, via: Sender, value: bigint) {
        const body = types.messageDonation();
        const sendMode = SendMode.PAY_GAS_SEPARATELY;

        await provider.internal(via, { value, sendMode, body });
    }

    async sendEnableDeposits(provider: ContractProvider, via: Sender, enabled: boolean) {
        const body = types.messageDepositsEnabled(enabled);
        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateTSS(provider: ContractProvider, via: Sender, newTSS: string) {
        const body = types.messageUpdateTSS(newTSS);
        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateCode(provider: ContractProvider, via: Sender, code: Cell) {
        const body = types.messageUpdateCode(code);
        await this.sendAuthorityCommand(provider, via, body);
    }

    async sendUpdateAuthority(provider: ContractProvider, via: Sender, authority: Address) {
        const body = types.messageUpdateAuthority(authority);
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
        const body = types.messageWithdraw(seqno, recipient, amount);

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
        const signature = crypto.ecdsaSignCell(signer, payload);
        const message = types.messageExternal(signature, payload);

        await provider.external(message);
    }

    async getBalance(provider: ContractProvider): Promise<bigint> {
        const state = await provider.getState();

        return state.balance;
    }

    async getGatewayState(provider: ContractProvider): Promise<types.GatewayState> {
        const response = await provider.get('query_state', []);

        return types.gatewayStateFromStack(response.stack);
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

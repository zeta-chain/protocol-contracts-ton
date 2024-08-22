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

export const opDeposit = 100;

export type GatewayConfig = {
    depositsEnabled: boolean;
};

// Initial state of the contract during deployment
export function gatewayConfigToCell(config: GatewayConfig): Cell {
    return beginCell()
        .storeUint(config.depositsEnabled ? 1 : 0, 1)
        .storeCoins(0) // valueLocked
        .storeCoins(0) // fees
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
            .storeUint(opDeposit, 32) // op code
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

    async getBalance(provider: ContractProvider): Promise<bigint> {
        const state = await provider.getState();

        return state.balance;
    }

    async getQueryState(provider: ContractProvider): Promise<[boolean, bigint]> {
        const response = await provider.get('query_state', []);

        const depositsEnabled = response.stack.readBoolean();
        const valueLocked = response.stack.readBigNumber();

        return [depositsEnabled, valueLocked];
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

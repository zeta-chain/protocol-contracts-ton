import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type GatewayConfig = {};

export function gatewayConfigToCell(config: GatewayConfig): Cell {
    return beginCell().endCell();
}

export class Gateway implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

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
}

import { NetworkProvider } from '@ton/blueprint';
import { Gateway } from '../wrappers/Gateway';
import { formatCoin } from '../tests/utils';
import * as accounts from '../tools/accounts';
import { Address } from '@ton/core';

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() === 'testnet';

    const gwAddress = await accounts.inputGateway(provider);

    const gw = await provider.open(Gateway.createFromAddress(gwAddress));

    const [state, balance, seqno] = await Promise.all([
        gw.getGatewayState(),
        gw.getBalance(),
        gw.getSeqno(),
    ]);

    console.log('Gateway', {
        enabled: state.depositsEnabled,
        tss: state.tss,
        authority: state.authority.toRawString(),
        value_locked: `${formatCoin(state.valueLocked)} TON`,
        balance: `${formatCoin(balance)} TON`,
        seqno: seqno,
    });

    console.log('Explorer link:');
    console.log(addressLink(gwAddress, isTestnet));
}

function addressLink(address: Address, isTestnet: boolean): string {
    const raw = address.toRawString();
    return isTestnet
        ? `https://testnet.tonscan.org/address/${raw}`
        : `https://tonscan.org/address/${raw}`;
}

import { NetworkProvider } from "@ton/blueprint";
import { Gateway } from "../wrappers/Gateway";
import { formatCoin } from "../tests/utils";
import { Address } from "@ton/core";

const GATEWAY_ACCOUNT_ID_TESTNET = Address.parse(
    '0:7a4d41496726aadb227cf4d313c95912f1fe6cc742c18ebde306ff59881d8816'
)

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() === 'testnet';

    const address = await provider.ui().inputAddress(
        'Enter Gateway address',
        isTestnet ? GATEWAY_ACCOUNT_ID_TESTNET : undefined,
    );

    const gw = await provider.open(Gateway.createFromAddress(address));

    const [state, balance, seqno] = await Promise.all([
        gw.getGatewayState(),
        gw.getBalance(),
        gw.getSeqno()
    ]);

    console.log('Gateway', {
        enabled: state.depositsEnabled,
        tss: state.tss,
        authority: state.authority.toRawString(),
        value_locked: `${formatCoin(state.valueLocked)} TON`,
        balance: `${formatCoin(balance)} TON`,
        seqno: seqno,
    });

    console.log('Explorer link:')
    console.log(addressLink(address, isTestnet));
}

function addressLink(address: Address, isTestnet: boolean): string {
    const raw = address.toRawString();
    return isTestnet
        ? `https://testnet.tonscan.org/address/${raw}`
        : `https://tonscan.org/address/${raw}`;

}

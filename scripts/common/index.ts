import { NetworkProvider } from '@ton/blueprint';
import { Address } from '@ton/core';

// https://testnet.tonviewer.com/kQB6TUFJZyaq2yJ89NMTyVkS8f5sx0LBjr3jBv9ZiB2IFoFu
export const GATEWAY_ACCOUNT_ID_TESTNET = Address.parse(
    '0:7a4d41496726aadb227cf4d313c95912f1fe6cc742c18ebde306ff59881d8816',
);

export async function inputGateway(provider: NetworkProvider): Promise<Address> {
    const isTestnet = provider.network() === 'testnet';

    return await provider
        .ui()
        .inputAddress('Enter Gateway address', isTestnet ? GATEWAY_ACCOUNT_ID_TESTNET : undefined);
}

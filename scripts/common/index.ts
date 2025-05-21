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

export async function inputNumber(
    provider: NetworkProvider,
    prompt: string,
    defaultValue: number,
    min = 1,
    max = 100,
): Promise<number> {
    const input = await provider.ui().input(`${prompt} (default is ${defaultValue})`);
    if (input === '') {
        return defaultValue;
    }

    const number = parseInt(input);

    if (isNaN(number) || number < min || number > max) {
        console.log(`Invalid number, using default value ${defaultValue}`);
        return defaultValue;
    }

    return number;
}

export function parseTxHash(txHash: string): { lt: string; hash: string } {
    const chunks = txHash.split(':');
    if (chunks.length !== 2) {
        throw new Error(`Invalid transaction hash "${txHash}"`);
    }

    const lt = chunks[0];

    // input requires hex, but ton client accepts base64
    const hash = Buffer.from(chunks[1], 'hex').toString('base64');

    return { lt, hash };
}

export function addressLink(address: Address, isTestnet: boolean): string {
    const raw = address.toRawString();
    return isTestnet
        ? `https://testnet.tonscan.org/address/${raw}`
        : `https://tonscan.org/address/${raw}`;
}

export function txLink(hash: string, isTestnet: boolean): string {
    return isTestnet ? `https://testnet.tonscan.org/tx/${hash}` : `https://tonscan.org/tx/${hash}`;
}

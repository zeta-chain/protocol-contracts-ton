import { NetworkProvider } from '@ton/blueprint';
import { Address } from '@ton/core';

// https://testnet.tonviewer.com/kQB6TUFJZyaq2yJ89NMTyVkS8f5sx0LBjr3jBv9ZiB2IFoFu
export const GATEWAY_ACCOUNT_ID_TESTNET = Address.parse(
    '0:87115e4a012e747d9bce013ce2244010c6d5e3b0f88ddbc63420519b8619e5a0',
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
): Promise<number> {
    const input = await provider.ui().input(`${prompt} (default is ${defaultValue})`);
    if (input === '') {
        return defaultValue;
    }

    const number = parseInt(input);

    if (isNaN(number) || number < min) {
        console.log(`Invalid number, using default value ${defaultValue}`);
        return defaultValue;
    }

    return number;
}

export async function inputString(
    provider: NetworkProvider,
    prompt: string,
    fallback: string = '',
): Promise<string> {
    const input = await provider.ui().input(`${prompt} (default: ${fallback})`);
    if (input === '') {
        return fallback;
    }

    return input;
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

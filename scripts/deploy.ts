import { OpenedContract, toNano } from '@ton/core';
import { Gateway } from '../wrappers/Gateway';
import { compile, NetworkProvider } from '@ton/blueprint';
import { formatCoin, GatewayConfig } from '../types';
import * as common from './common';

async function open(provider: NetworkProvider): Promise<OpenedContract<Gateway>> {
    const tss = await provider.ui().input('Enter TSS address');
    const authority = provider.sender().address!;

    const ack =
        `The sender ${authority} is going to be used as the authority address.` +
        ` Press Enter to continue.`;

    const ok = await provider.ui().prompt(ack);
    if (!ok) {
        throw new Error('Aborted');
    }

    const seqno = await common.inputNumber(provider, 'seqno', 0, 0);
    const totalLocked = await common.inputNumber(provider, 'total_locked (in nano ton)', 0);

    const config: GatewayConfig = {
        depositsEnabled: true,
        tss,
        authority,
        totalLocked: BigInt(totalLocked),
        seqno,
    };

    console.log('GatewayConfig', {
        depositsEnabled: config.depositsEnabled,
        tss,
        authority: authority.toRawString(),
        totalLocked: formatCoin(config.totalLocked),
        seqno,
    });

    const code = await compile('Gateway');

    return provider.open(Gateway.createFromConfig(config, code));
}

export async function run(provider: NetworkProvider) {
    const sender = provider.sender();
    const gateway = await open(provider);

    console.log(`Gateway address: ${gateway.address.toString()}`);

    // Deploy
    const isDeployed = await provider.isContractDeployed(gateway.address);

    if (!isDeployed) {
        console.log('Deploying...');
        await gateway.sendDeploy(sender, toNano('0.5'));
        await provider.waitForDeploy(gateway.address);
    } else {
        console.log('Already deployed!');
    }

    // Send sample deposit
    console.log('Performing a sample deposit...');

    const recipient = await provider.ui().input('Enter EVM recipient address');

    let amount = await provider.ui().input('Enter amount to deposit. [default: 1 TON]');
    if (amount === '') {
        amount = '1';
    }

    await gateway.sendDeposit(sender, toNano(amount), recipient);
}

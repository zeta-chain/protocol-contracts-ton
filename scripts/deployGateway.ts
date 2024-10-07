import { OpenedContract, toNano } from '@ton/core';
import { Gateway, GatewayConfig } from '../wrappers/Gateway';
import { compile, NetworkProvider } from '@ton/blueprint';
import { formatCoin } from '../tests/utils'; // https://etherscan.io/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

// https://etherscan.io/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
const vitalikDotETH = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

// TEST PURPOSES ONLY
export const sampleTSS = '0x70e967acfcc17c3941e87562161406d41676fd83';

async function open(provider: NetworkProvider): Promise<OpenedContract<Gateway>> {
    const config: GatewayConfig = {
        depositsEnabled: true,
        tss: sampleTSS,
        authority: provider.sender().address!,
    };

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
        await gateway.sendDeploy(sender, toNano('0.05'));
        await provider.waitForDeploy(gateway.address);
    } else {
        console.log('Already deployed');
    }

    // Deposit 1 TON to Vitalik's address on ZetaChain
    await gateway.sendDeposit(sender, toNano('1'), vitalikDotETH);

    // Query the state. Note that contract will be queried instantly
    // w/o waiting for the tx to be processed, so expect outdated data
    const { valueLocked } = await gateway.getGatewayState();
    console.log(`Total locked: ${formatCoin(valueLocked)}`);
}

import { toNano } from '@ton/core';
import { Gateway } from '../wrappers/Gateway';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const gateway = provider.open(Gateway.createFromConfig({}, await compile('Gateway')));

    await gateway.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(gateway.address);

    // run methods on `gateway`
}

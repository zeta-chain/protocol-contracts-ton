import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { Gateway } from '../wrappers/Gateway';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('Gateway', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Gateway');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let gateway: SandboxContract<Gateway>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        gateway = blockchain.openContract(Gateway.createFromConfig({}, code));

        deployer = await blockchain.treasury('deployer');

        const deployResult = await gateway.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: gateway.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and gateway are ready to use
    });
});

import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, Slice, toNano, Transaction } from '@ton/core';
import { Gateway, GatewayConfig } from '../wrappers/Gateway';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { findTransaction, FlatTransactionComparable } from '@ton/test-utils/dist/test/transaction'; // copied from `errors.fc`

// copied from `errors.fc`
const err_no_intent = 101;

// copied from `gas.fc`
const gas_fee = toNano('0.01');

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

        const deployConfig: GatewayConfig = {
            depositsEnabled: true,
        };

        gateway = blockchain.openContract(Gateway.createFromConfig(deployConfig, code));

        deployer = await blockchain.treasury('deployer');

        const deployResult = await gateway.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: gateway.address,
            deploy: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and gateway are ready to use

        // ASSERT
        // Check that initial state is queried correctly
        const [depositsEnabled, valueLocked] = await gateway.getQueryState();

        expect(depositsEnabled).toBe(true);
        expect(valueLocked).toBe(0n);
    });

    it('should fail without opcode and query id', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // And its balance
        const senderBalanceBefore = await sender.getBalance();

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // ACT
        const result = await sender.send({
            to: gateway.address,
            value: toNano('0.01'),
        });

        // ASSERT
        // Check that tx failed with expected status code
        expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: false,
            exitCode: err_no_intent,
        });

        // Make sure that balance is decreased by gas fee ...
        const senderBalanceAfter = await sender.getBalance();
        expect(senderBalanceAfter).toBeLessThan(senderBalanceBefore);

        // ... And gateway balance is not changed
        const gatewayBalanceAfter = await gateway.getBalance();
        expect(gatewayBalanceAfter).toEqual(gatewayBalanceBefore);
    });

    it('should perform a simple deposit', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given memo with EVM address (20 bytes)
        const evmAddress = '0x92215391d24c75eb005eb4b7c8c55bf0036604a5';
        const memo = evmAddressToSlice(evmAddress);

        // Given amount to deposit
        const amount = toNano('1');

        // ACT
        const result = await gateway.sendDeposit(sender.getSender(), amount, memo);

        // ASSERT
        // Check that tx failed with expected status code
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: true,
        });

        logGasUsage(tx);

        // Check gateway balance
        const gatewayBalanceAfter = await gateway.getBalance();

        // result should be >= (before + amount - gas_fee)
        expect(gatewayBalanceAfter).toBeGreaterThanOrEqual(gatewayBalanceBefore + amount - gas_fee);

        // Check that valueLocked is updated
        const [_, valueLocked] = await gateway.getQueryState();

        expect(valueLocked).toEqual(amount - gas_fee);

        // Check that we have a log with exact amount
        // todo
    });

    // todo should fail w/o value too small
    // todo should fail w/o memo
    // todo should fail w/ invalid memo (too short)
    // todo arbitrary long memo
    // todo check that gas costs are always less than 0.01 for long memos
    // todo deposits disabled
});

function expectTX(transactions: Transaction[], cmp: FlatTransactionComparable): Transaction {
    expect(transactions).toHaveTransaction(cmp);

    const tx = findTransaction(transactions, cmp);
    expect(tx).toBeDefined();

    return tx!;
}

function evmAddressToSlice(address: string): Slice {
    expect(address.length).toEqual(42);

    // Remove the '0x' prefix
    const hexString = address.slice(2);

    // Convert to Buffer
    const buffer = Buffer.from(hexString, 'hex');
    expect(buffer.length).toEqual(20);

    return beginCell().storeBuffer(buffer).asSlice();
}

function logGasUsage(tx: Transaction): void {
    const testName = expect.getState().currentTestName;
    console.log(`test "${testName}": gas used`, formatCoin(tx.totalFees.coins));
}

// returns a string with a decimal point
function formatCoin(coins: bigint): string {
    const divisor = 1_000_000_000n;

    const tons = coins / divisor;
    const fractional = coins % divisor;

    // Ensure the fractional part is always 9 digits by padding with leading zeros if necessary
    const fractionalStr = fractional.toString().padStart(9, '0');

    return `${tons.toString()}.${fractionalStr} TON`;
}

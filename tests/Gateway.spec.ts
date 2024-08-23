import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, Transaction } from '@ton/core';
import { Gateway, GatewayConfig, opDeposit, parseDepositLog } from '../wrappers/Gateway';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { evmAddressToSlice, loadHexStringFromSlice, logGasUsage } from './utils';
import { findTransaction, FlatTransactionComparable } from '@ton/test-utils/dist/test/transaction'; // copied from `errors.fc`

// copied from `errors.fc`
const err_no_intent = 101;

// copied from `gas.fc`
const gas_fee = toNano('0.01');

const tssAddress = '0x70e967acfcc17c3941e87562161406d41676fd83';

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
            tssAddress: tssAddress,
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
        const [depositsEnabled, valueLocked, tss] = await gateway.getQueryState();

        expect(depositsEnabled).toBe(true);
        expect(valueLocked).toBe(0n);
        expect(tss).toBe(tssAddress);

        // Check that seqno works and is zero
        const nonce = await gateway.getSeqno();
        expect(nonce).toBe(0);
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

        logGasUsage(expect, tx);

        // Check gateway balance
        const gatewayBalanceAfter = await gateway.getBalance();

        // result should be >= (before + amount - gas_fee)
        expect(gatewayBalanceAfter).toBeGreaterThanOrEqual(gatewayBalanceBefore + amount - gas_fee);

        // Check that valueLocked is updated
        const [_, valueLocked] = await gateway.getQueryState();

        expect(valueLocked).toEqual(amount - gas_fee);

        // Check that we have a log with the exact amount
        expect(tx.outMessagesCount).toEqual(1);

        // Check for data in the log message
        const depositLog = parseDepositLog(tx.outMessages.get(0)!.body);

        expect(depositLog.op).toEqual(opDeposit);
        expect(depositLog.queryId).toEqual(0);
        expect(depositLog.sender.toRawString()).toEqual(sender.address.toRawString());
        expect(depositLog.amount).toEqual(amount - gas_fee);

        // Check that memo logged properly
        const memoAddress = loadHexStringFromSlice(depositLog.memo.asSlice(), 20);

        expect(memoAddress).toEqual(evmAddress);
    });

    // todo donation
    // todo should fail w/o value too small
    // todo should fail w/o memo
    // todo should fail w/ invalid memo (too short)
    // todo arbitrary long memo
    // todo check that gas costs are always less than 0.01 for long memos
    // todo deposits disabled
});

export function expectTX(transactions: Transaction[], cmp: FlatTransactionComparable): Transaction {
    expect(transactions).toHaveTransaction(cmp);

    const tx = findTransaction(transactions, cmp);
    expect(tx).toBeDefined();

    return tx!;
}

import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano, Transaction } from '@ton/core';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as utils from './utils';
import { formatCoin } from './utils';
import { findTransaction, FlatTransactionComparable } from '@ton/test-utils/dist/test/transaction';
import { ethers } from 'ethers';
import { readString, stringToCell } from '@ton/core/dist/boc/utils/strings';
import path from 'node:path';
import * as fs from 'node:fs';
import * as gw from '../wrappers/Gateway';

// Sample TSS wallet. In reality there's no single private key
const tssWallet = new ethers.Wallet(
    '0xb984cd65727cfd03081fc7bf33bf5c208bca697ce16139b5ded275887e81395a',
);

const someRandomEvmWallet = new ethers.Wallet(
    '0xaa8abe680332aadf79315691144f90737c0fd5b5387580c220ce40acbf2c1562',
);

const startOfYear = new Date(new Date().getFullYear(), 0, 1);

const UNIX_DAY = 60 * 60 * 24;

describe('Gateway', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Gateway');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let gateway: SandboxContract<gw.Gateway>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        // Let's say that right now it Jan 1st
        blockchain.now = unix(startOfYear);

        // Deploy the deployer :)
        deployer = await blockchain.treasury('deployer');

        const deployConfig: gw.GatewayConfig = {
            depositsEnabled: true,
            tss: tssWallet.address,
            authority: deployer.address,
        };

        gateway = blockchain.openContract(gw.Gateway.createFromConfig(deployConfig, code));

        // Deploy the gateway
        const deployResult = await gateway.sendDeploy(deployer.getSender(), toNano('1000'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: gateway.address,
            deploy: true,
        });

        // Okay, now we want to emulate that a WEEK passed since the last contract interaction.
        // This will trigger some storage fees.
        blockchain.now = unix(startOfYear) + UNIX_DAY * 7;
    });

    let loggedTransactions: [string, utils.TxFeeReport, bigint, bigint][] = [];

    // Helper function to analyze transaction fees after all tests (print their gas usage, fees, etc.)
    const analyzeTX = (
        expect: jest.Expect,
        tx: Transaction,
        balanceBefore: bigint,
        balanceAfter: bigint,
    ) => {
        const testName = expect.getState().currentTestName!;
        const report = utils.reportTXFees(tx);

        loggedTransactions.push([testName, report, balanceBefore, balanceAfter]);
    };

    // Dumps all transactions to console & CSV after all tests
    afterAll(() => {
        const table = loggedTransactions.map(([name, report, balanceBefore, balanceAfter]) => {
            const outMsgsCoins = report.outMessages.reduce(
                (total, msgFee) => total + msgFee.coins,
                0n,
            );

            const outMsgsFees = report.outMessages.reduce(
                (total, msgFee) => total + msgFee.forwardFee + msgFee.importFee,
                0n,
            );

            // noinspection JSNonASCIINames
            return {
                'TX Label': name,

                'GW Balance Before': utils.formatCoin(balanceBefore),
                'InMsg Coins': utils.formatCoin(report.inMessage.coins),
                'OutMsgs Coins': utils.formatCoin(outMsgsCoins),
                'GW Balance after': utils.formatCoin(balanceAfter),

                'Total Fees': utils.formatCoin(report.totalFees),
                'Storage Fees': utils.formatCoin(report.storageFees),
                'Compute Fees': utils.formatCoin(report.computeFees),
                'Gas Used': Number(report.gasUsed),
                'Action Fees': utils.formatCoin(report.actionFees),
                'Fwd Fees': utils.formatCoin(report.fwdFees),
                'InMsg Import Fee': utils.formatCoin(report.inMessage.importFee),
                'InMsg Fwd Fee': utils.formatCoin(report.inMessage.forwardFee),
                'OutMsgs fees': utils.formatCoin(outMsgsFees),
            };
        });

        // Brief Summary
        console.table(table, [
            'TX Label',
            'Total Fees',
            'Storage Fees',
            'Compute Fees',
            'Gas Used',
            'Action Fees',
            'InMsg Fwd Fee',
            'OutMsgs fees',
        ]);

        table.map((row) => console.table(row));

        dumpArrayToCSV(table, `gas-${jest.getSeed()}.csv`);
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and gateway are ready to use

        // ASSERT
        // Check that initial state is queried correctly
        const state = await gateway.getGatewayState();

        expect(state.depositsEnabled).toBe(true);
        expect(state.valueLocked).toBe(0n);
        expect(state.tss).toBe(tssWallet.address.toLowerCase());
        expect(state.authority.toRawString()).toBe(deployer.address.toRawString());

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
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: false,
            exitCode: gw.GatewayError.NoIntent,
        });

        // Make sure that balance is decreased by gas fee ...
        const senderBalanceAfter = await sender.getBalance();
        expect(senderBalanceAfter).toBeLessThan(senderBalanceBefore);

        // ... And gateway balance is not changed
        const gatewayBalanceAfter = await gateway.getBalance();
        expect(gatewayBalanceAfter).toEqual(gatewayBalanceBefore);

        analyzeTX(expect, tx, gatewayBalanceBefore, gatewayBalanceAfter);
    });

    it('should perform a deposit', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given memo with EVM address (20 bytes)
        const evmAddress = '0x92215391d24c75eb005eb4b7c8c55bf0036604a5';

        // Given amount to deposit
        const amount = toNano('1');

        // Given approx tx fee
        const approxTXFee = await gateway.getTxFee(gw.GatewayOp.Deposit);

        // ACT
        const result = await gateway.sendDeposit(sender.getSender(), amount, evmAddress);

        // ASSERT
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: true,
        });

        // Check gateway balance
        const gatewayBalanceAfter = await gateway.getBalance();

        analyzeTX(expect, tx, gatewayBalanceBefore, gatewayBalanceAfter);

        // Check gas usage
        expect(tx.totalFees.coins).toBeLessThanOrEqual(approxTXFee);

        // result should be >= (before + amount - gasFee)
        expect(gatewayBalanceAfter).toBeGreaterThanOrEqual(
            gatewayBalanceBefore + amount - approxTXFee,
        );

        // Check that valueLocked is updated
        const { valueLocked } = await gateway.getGatewayState();

        expect(valueLocked).toEqual(amount - approxTXFee);

        // Check that we have a log with the exact amount
        expect(tx.outMessagesCount).toEqual(1);

        // Check for data in the log message
        const log = gw.parseDepositLog(tx.outMessages.get(0)!.body);

        expect(log.amount).toEqual(amount - approxTXFee);
        expect(log.depositFee).toEqual(approxTXFee);
    });

    it('should fail deposit due to amount too small', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given memo with EVM address (20 bytes)
        const evmAddress = '0x92215391d24c75eb005eb4b7c8c55bf0036604a5';

        // Given approx tx fee
        const approxTXFee = await gateway.getTxFee(gw.GatewayOp.Deposit);

        // Given amount to deposit that is 66% of approx tx fee
        const amount = (approxTXFee * 2n) / 3n;

        // ACT
        const result = await gateway.sendDeposit(sender.getSender(), amount, evmAddress);

        // ASSERT
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: false,
            exitCode: gw.GatewayError.InsufficientValue,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());
    });

    it('should perform a depositAndCall', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // Given zevm address
        const recipient = '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5';

        // Given quite a long call data
        const longText = readFixture('long-call-data.txt');
        const callData = stringToCell(longText);

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given approx tx fee
        const approxTXFee = await gateway.getTxFee(gw.GatewayOp.DepositAndCall);

        // ACT
        const amount = toNano('10');
        const result = await gateway.sendDepositAndCall(
            sender.getSender(),
            amount,
            recipient,
            callData,
        );

        // ASSERT
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: true,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());

        // Check gas usage
        expect(tx.totalFees.coins).toBeLessThanOrEqual(approxTXFee);

        // Check log
        const log = gw.parseDepositLog(tx.outMessages.get(0)!.body);

        expect(log.amount).toBeLessThan(amount);
        expect(log.depositFee).toEqual(approxTXFee);

        // Parse call data from the internal message
        const body = tx.inMessage!.body.beginParse();

        // skip op + query_id + evm address
        const callDataCell = body.skip(64 + 32 + 160).loadRef();

        const callDataRestored = readString(callDataCell.asSlice());
        expect(callDataRestored).toEqual(longText);
    });

    it('should fail depositAndCall due to missing memo', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // Given zevm address
        const recipient = '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5';

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // ACT
        const amount = toNano('10');
        const result = await gateway.sendDepositAndCall(
            sender.getSender(),
            amount,
            recipient,
            beginCell().endCell(),
        );

        // ASSERT
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            exitCode: gw.GatewayError.InvalidCallData,
            success: false,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());
    });

    it('should fail depositAndCall due to large memo', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // Given zevm address
        const recipient = '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5';

        // Given quite a long call data x2
        const longText = readFixture('long-call-data.txt');
        const callData = stringToCell(longText + longText);

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // ACT
        const result = await gateway.sendDepositAndCall(
            sender.getSender(),
            toNano('10'),
            recipient,
            callData,
        );

        // ASSERT
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: false,
            exitCode: gw.GatewayError.InvalidCallData,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());
    });

    it('should perform a donation', async () => {
        // ARRANGE
        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given a sender
        const sender = await blockchain.treasury('sender2');

        // Given amount to deposit
        const amount = toNano('5');

        // ACT
        const result = await gateway.sendDonation(sender.getSender(), amount);

        // ASSERT
        // Check that tx failed with expected status code
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: true,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());

        // Check that valueLocked is NOT updated
        const { valueLocked } = await gateway.getGatewayState();

        // Donation doesn't count as a deposit, so no net-new locked value.
        expect(valueLocked).toEqual(0n);

        // Check that we don't have any logs
        expect(tx.outMessagesCount).toEqual(0);

        // Check that balance is updated
        const gatewayBalanceAfter = await gateway.getBalance();
        const dust = toNano('0.01');
        expect(gatewayBalanceAfter).toBeGreaterThanOrEqual(gatewayBalanceBefore + amount - dust);
    });

    it('should perform a withdrawal', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender3');

        // Who deposited ~10 TON in the gateway
        const depositAmount = toNano('10');
        const dust = toNano('0.01');

        await gateway.sendDeposit(
            sender.getSender(),
            depositAmount + dust,
            '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5',
        );

        const gwStateBefore = await gateway.getGatewayState();
        const valueLockedBefore = gwStateBefore.valueLocked;

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given approx withdrawal tx fee
        const approxTXFee = await gateway.getTxFee(gw.GatewayOp.Withdraw);

        // Given sender balance BEFORE withdrawal
        const senderBalanceBefore = await sender.getBalance();

        // Given a withdrawal payload ...
        const withdrawAmount = toNano('3');

        // ACT
        // Withdraw TON to the same sender on the behalf of TSS
        const result = await gateway.sendWithdraw(tssWallet, sender.address, withdrawAmount);

        // ASSERT 1 / Withdrawal TX
        // Check withdrawal tx based on external message
        const withdrawalTx = expectTX(result.transactions, {
            from: undefined,
            to: gateway.address,
            success: true,
        });

        const gatewayBalanceAfter = await gateway.getBalance();

        analyzeTX(expect, withdrawalTx, gatewayBalanceBefore, gatewayBalanceAfter);

        // Check tx gas fee
        expect(withdrawalTx.totalFees.coins).toBeLessThanOrEqual(approxTXFee);

        // Check that locked funds are updated (as well as gw balance)
        const { valueLocked } = await gateway.getGatewayState();
        const maxExpense = withdrawAmount + approxTXFee;
        const valueLockedDelta = valueLockedBefore - valueLocked;
        const gatewayBalanceDelta = gatewayBalanceBefore - gatewayBalanceAfter;

        console.table({
            'Withdrawal Amount': formatCoin(withdrawAmount),
            'Max Expense (with approx tx fee)': formatCoin(maxExpense),
            'Value Locked Before': formatCoin(valueLockedBefore),
            'Value Locked After': formatCoin(valueLocked),
            'Value Locked Delta': formatCoin(valueLockedDelta),
            'Balance Before': formatCoin(gatewayBalanceBefore),
            'Balance After': formatCoin(gatewayBalanceAfter),
            'Balance Delta': formatCoin(gatewayBalanceDelta),
        });

        expect(valueLocked).toBeGreaterThanOrEqual(valueLockedBefore - maxExpense);
        expect(gatewayBalanceAfter).toBeGreaterThanOrEqual(gatewayBalanceBefore - maxExpense);

        expect(maxExpense).toEqual(valueLockedDelta);
        expect(gatewayBalanceDelta).toBeLessThanOrEqual(valueLockedDelta);

        // Check nonce
        const seqno = await gateway.getSeqno();
        expect(seqno).toEqual(1);

        // ASSERT 2 / Second tx with withdrawal amount
        // Check that tx is successful and contains expected outbound internal message
        const tx = expectTX(result.transactions, {
            from: gateway.address,
            to: sender.address,
            success: true,
            value: withdrawAmount,
        });

        // Check that sender's balance is updated
        const senderBalanceAfter = await sender.getBalance();

        expect(senderBalanceAfter).toBeGreaterThanOrEqual(
            senderBalanceBefore + withdrawAmount - tx.totalFees.coins,
        );
    });

    it('should withdraw for non-existent address', async () => {
        // ARRANGE
        // Given some funds in the gateway
        await gateway.sendDeposit(
            deployer.getSender(),
            toNano('10'),
            '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5',
        );

        const gatewayBalanceBefore = await gateway.getBalance();

        // Given a receiver that is NOT yet deployed
        let receiver = await blockchain.treasury('receiver', { predeploy: false });

        const receiverState = await blockchain.getContract(receiver.address);
        expect(receiverState.accountState?.type).toEqual('uninit');

        // Given a withdrawal amount
        const withdrawAmount = toNano('5');

        // ACT
        // Withdraw TON to the same sender on the behalf of TSS
        const result = await gateway.sendWithdraw(tssWallet, receiver.address, withdrawAmount);

        // ASSERT
        // We should have 2 txs:
        //   - tx1: external message -> gateway -> send to receiver
        //   - tx2: internal message from the gateway -> sent to non-existent receiver
        expect(result.transactions.length).toEqual(2);

        // Check withdrawal tx invoked by external message
        const withdrawalTX = expectTX(result.transactions, {
            from: undefined,
            to: gateway.address,
            success: true,
        });

        analyzeTX(expect, withdrawalTX, gatewayBalanceBefore, await gateway.getBalance());

        // Check received tx
        expectTX(result.transactions, {
            from: gateway.address,
            to: receiver.address,
            value: withdrawAmount,
            aborted: true,
        });
    });

    it('should fail a withdrawal signed not by TSS', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender4');

        // Who deposited 10 TON in the gateway
        await gateway.sendDeposit(sender.getSender(), toNano('10'), someRandomEvmWallet.address);

        // Given a withdrawal payload ...
        const recipient = gateway.address;
        const amount = toNano('5');

        // ACT & ASSERT
        // Withdraw TON and expect an error
        try {
            // Sign with some random wallet
            await gateway.sendWithdraw(someRandomEvmWallet, recipient, amount);
        } catch (e: any) {
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(gw.GatewayError.InvalidSignature);
        }
    });

    it('should fail a withdrawal to itself', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender4');

        // Who deposited 10 TON in the gateway
        await gateway.sendDeposit(sender.getSender(), toNano('10'), someRandomEvmWallet.address);

        // Given a withdrawal payload ...
        const recipient = gateway.address;
        const amount = toNano('5');

        // ACT & ASSERT
        // Withdraw TON and expect an error
        try {
            await gateway.sendWithdraw(tssWallet, recipient, amount);
        } catch (e: any) {
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(gw.GatewayError.InvalidTVMRecipient);
        }
    });

    it('should enable or disable deposits', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender5');

        // Given some donation to the Gateway
        await gateway.sendDonation(sender.getSender(), toNano('10'));

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // ACT 1
        // Disable deposits
        const result1 = await gateway.sendEnableDeposits(deployer.getSender(), false);

        // ASSERT 1
        const tx = expectTX(result1.transactions, {
            from: deployer.address,
            to: gateway.address,
            success: true,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());

        // Check that deposits are disabled
        const { depositsEnabled } = await gateway.getGatewayState();
        expect(depositsEnabled).toBe(false);

        // ACT 2
        // Send sample deposit
        const result2 = await gateway.sendDeposit(sender.getSender(), toNano('1'), 123n);

        // ASSERT 2
        // It should fail
        expectTX(result2.transactions, {
            from: sender.address,
            to: gateway.address,
            success: false,
            exitCode: gw.GatewayError.DepositsDisabled,
        });

        // ACT 3
        // Enable deposits back
        const result3 = await gateway.sendEnableDeposits(deployer.getSender(), true);
        expectTX(result3.transactions, {
            from: deployer.address,
            to: gateway.address,
            success: true,
        });

        // ACT 4
        // Send another deposit
        const result4 = await gateway.sendDeposit(
            sender.getSender(),
            toNano('1'),
            '0x23f4569002a5a07f0ecf688142eeb6bcd883eef8',
        );

        // ASSERT 4
        // It should succeed
        expectTX(result4.transactions, {
            from: sender.address,
            to: gateway.address,
            success: true,
        });

        // ACT 5
        // Disable deposits, but sender IS NOT an authority
        const result5 = await gateway.sendEnableDeposits(sender.getSender(), false);

        // ASSERT  5
        expectTX(result5.transactions, {
            from: sender.address,
            to: gateway.address,
            success: false,
            exitCode: gw.GatewayError.InvalidAuthority,
        });
    });

    it('should update tss address', async () => {
        // ARRANGE
        // Given some TON in the Gateway
        await gateway.sendDonation(deployer.getSender(), toNano('10'));

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given a new TSS address
        // Let's say we've bumped the number of observer&signers, thus we require a new TSS wallet
        const newTss = new ethers.Wallet(
            '0x428239b1357227e03543875521be772c3126d383c4422328503cd0ac42e4ea0b',
        );

        console.log('New TSS', newTss.address);

        // ACT 1
        // Update TSS address
        const result1 = await gateway.sendUpdateTSS(deployer.getSender(), newTss.address);

        // ASSERT 1
        // Check that tx is successful
        const tx = expectTX(result1.transactions, {
            from: deployer.address,
            to: gateway.address,
            op: gw.GatewayOp.UpdateTSS,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());

        // Check that tss was updated
        const { tss } = await gateway.getGatewayState();
        expect(tss).toEqual(newTss.address.toLowerCase());
    });

    it('should update the code', async () => {
        // ARRANGE
        // Given some value in the Gateway
        await gateway.sendDonation(deployer.getSender(), toNano('10'));

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given a new code
        const code = await utils.compileFuncInline(`
          () recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
               return ();
          }

          (slice) ping() method_id {
                return "pong";
          }
        `);

        // ACT
        // Update the code
        const result = await gateway.sendUpdateCode(deployer.getSender(), code);

        // ASSERT
        const tx = expectTX(result.transactions, {
            from: deployer.address,
            to: gateway.address,
            op: gw.GatewayOp.UpdateCode,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());

        // Try to query this new "ping" method
        const result2 = await blockchain.runGetMethod(gateway.address, 'ping', []);
        const message = result2.stackReader.readString();
        expect(message).toEqual('pong');

        // Try to trigger some TSS command
        // It should fail because external_message is not implemented anymore! :troll:
        try {
            await gateway.sendEnableDeposits(deployer.getSender(), true);
        } catch (e: any) {
            // https://docs.ton.org/learn/tvm-instructions/tvm-exit-codes
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(11);
        }
    });

    it('should update authority', async () => {
        // ARRANGE
        // Given some value in the Gateway
        await gateway.sendDonation(deployer.getSender(), toNano('10'));

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given a new authority
        const newAuth = await blockchain.treasury('newAuth');

        // ACT 1
        // Update authority
        const result1 = await gateway.sendUpdateAuthority(deployer.getSender(), newAuth.address);

        // ASSERT 1
        const tx = expectTX(result1.transactions, {
            from: deployer.address,
            to: gateway.address,
            op: gw.GatewayOp.UpdateAuthority,
        });

        analyzeTX(expect, tx, gatewayBalanceBefore, await gateway.getBalance());

        const state = await gateway.getGatewayState();
        expect(state.authority.toRawString()).toEqual(newAuth.address.toRawString());

        // ACT 2
        // Try to disable deposits with the new authority
        const result2 = await gateway.sendEnableDeposits(newAuth.getSender(), false);

        // ASSERT 2
        expectTX(result2.transactions, {
            from: newAuth.address,
            to: gateway.address,
            op: gw.GatewayOp.SetDepositsEnabled,
            success: true,
        });

        // ACT 3
        // And do the same for old authority and fail
        const result3 = await gateway.sendEnableDeposits(deployer.getSender(), false);

        // ASSERT 3
        expectTX(result3.transactions, {
            from: deployer.address,
            to: gateway.address,
            exitCode: gw.GatewayError.InvalidAuthority,
            success: false,
        });
    });
});

export function expectTX(transactions: Transaction[], cmp: FlatTransactionComparable): Transaction {
    expect(transactions).toHaveTransaction(cmp);

    const tx = findTransaction(transactions, cmp);
    expect(tx).toBeDefined();

    return tx!;
}

function readFixture(fixturePath: string): string {
    const filePath = path.resolve(__dirname, '../tests/fixtures/', fixturePath);
    const buf = fs.readFileSync(filePath, 'utf-8');

    return buf.toString();
}

function unix(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}

function dumpArrayToCSV(data: Array<any>, fileName: string) {
    const headers = Object.keys(data[0]);

    const csvRows = data.map((entry) => {
        return headers.map((header) => `${entry[header]}`).join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n').replace(/ ton/g, '');

    const filePath = path.join(process.cwd(), 'temp', 'tests', fileName);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, csvContent, 'utf8');

    console.log(`CSV file saved to: ${filePath}`);
}

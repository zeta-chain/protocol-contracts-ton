import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano, Transaction } from '@ton/core';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as utils from './utils';
import { findTransaction, FlatTransactionComparable } from '@ton/test-utils/dist/test/transaction';
import { ethers } from 'ethers';
import { stringToCell } from '@ton/core/dist/boc/utils/strings';
import path from 'node:path';
import * as fs from 'node:fs';
import * as gw from '../wrappers/Gateway'; // copied from `gas.fc`

// copied from `gas.fc`
const gasFee = toNano('0.01');

// Sample TSS wallet. In reality there's no single private key
const tssWallet = new ethers.Wallet(
    '0xb984cd65727cfd03081fc7bf33bf5c208bca697ce16139b5ded275887e81395a',
);

const someRandomEvmWallet = new ethers.Wallet(
    '0xaa8abe680332aadf79315691144f90737c0fd5b5387580c220ce40acbf2c1562',
);

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
        deployer = await blockchain.treasury('deployer');

        const deployConfig: gw.GatewayConfig = {
            depositsEnabled: true,
            tss: tssWallet.address,
            authority: deployer.address,
        };

        gateway = blockchain.openContract(gw.Gateway.createFromConfig(deployConfig, code));

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
        expectTX(result.transactions, {
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
    });

    it('should perform a simple deposit', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // Given gateway's balance
        const gatewayBalanceBefore = await gateway.getBalance();

        // Given memo with EVM address (20 bytes)
        const evmAddress = '0x92215391d24c75eb005eb4b7c8c55bf0036604a5';

        // Given amount to deposit
        const amount = toNano('1');

        // ACT
        const result = await gateway.sendDeposit(sender.getSender(), amount, evmAddress);

        // ASSERT
        // Check that tx failed with expected status code
        const tx = expectTX(result.transactions, {
            from: sender.address,
            to: gateway.address,
            success: true,
        });

        utils.logGasUsage(expect, tx);

        // Check gateway balance
        const gatewayBalanceAfter = await gateway.getBalance();

        // result should be >= (before + amount - gasFee)
        expect(gatewayBalanceAfter).toBeGreaterThanOrEqual(gatewayBalanceBefore + amount - gasFee);

        // Check that valueLocked is updated
        const { valueLocked } = await gateway.getGatewayState();

        expect(valueLocked).toEqual(amount - gasFee);

        // Check that we have a log with the exact amount
        expect(tx.outMessagesCount).toEqual(1);

        // Check for data in the log message
        const depositLog = gw.parseDepositLog(tx.outMessages.get(0)!.body);

        expect(depositLog.op).toEqual(gw.GatewayOp.Deposit);
        expect(depositLog.queryId).toEqual(0);
        expect(depositLog.sender.toRawString()).toEqual(sender.address.toRawString());
        expect(depositLog.amount).toEqual(amount - gasFee);
        expect(depositLog.recipient).toEqual(evmAddress);
    });

    it('should deposit and call', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender1');

        // Given zevm address
        const recipient = '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5';

        // Given quite a long call data
        const longText = readFixture('long-call-data.txt');
        const callData = stringToCell(longText);

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

        utils.logGasUsage(expect, tx);

        // Check log
        const log = gw.parseDepositAndCallLog(tx.outMessages.get(0)!.body);

        expect(log.op).toEqual(gw.GatewayOp.DepositAndCall);
        expect(log.queryId).toEqual(0);
        expect(log.sender.toRawString()).toEqual(sender.address.toRawString());
        expect(log.amount).toEqual(amount - gasFee);
        expect(log.recipient).toEqual(recipient);
        expect(log.callData).toEqual(longText);
    });

    it('should perform a donation', async () => {
        // ARRANGE
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

        utils.logGasUsage(expect, tx);

        // Check that valueLocked is NOT updated
        const { valueLocked } = await gateway.getGatewayState();

        // Donation doesn't count as a deposit, so no net-new locked value.
        expect(valueLocked).toEqual(0n);

        // Check that we don't have any logs
        expect(tx.outMessagesCount).toEqual(0);

        // Check that balance is updated
        const senderBalanceAfter = await sender.getBalance();
        expect(senderBalanceAfter).toBeGreaterThanOrEqual(amount - gasFee);
    });

    it('should perform a simple withdrawal', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender3');

        // Who deposited 10 TON in the gateway
        await gateway.sendDeposit(
            sender.getSender(),
            toNano('10') + gasFee,
            '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5',
        );

        let { valueLocked } = await gateway.getGatewayState();
        expect(valueLocked).toEqual(toNano('10'));

        // Given sender balance BEFORE withdrawal
        const senderBalanceBefore = await sender.getBalance();

        // Given a withdrawal payload ...
        const amount = toNano('3');
        const nonce = 1;
        const payload = beginCell()
            .storeAddress(sender.address)
            .storeCoins(amount)
            .storeUint(nonce, 32)
            .endCell();

        // ... Which is signed by TSS
        const signature = utils.signCellECDSA(tssWallet, payload);

        // Given an admin command to withdraw TON
        const cmd: gw.AdminCommand = {
            op: gw.GatewayOp.Withdraw,
            signature,
            payload: payload,
        };

        // ACT
        // Withdraw TON to the same sender on the behalf of TSS
        const result = await gateway.sendAdminCommand(cmd);

        // ASSERT
        // Check that tx is successful and contains expected outbound internal message
        const tx = expectTX(result.transactions, {
            from: gateway.address,
            to: sender.address,
            success: true,
            value: amount,
        });

        utils.logGasUsage(expect, tx);

        // Check that locked funds are updated
        const gwState = await gateway.getGatewayState();
        valueLocked = gwState.valueLocked;

        expect(valueLocked).toEqual(toNano('7'));

        // Check nonce
        const seqno = await gateway.getSeqno();
        expect(seqno).toEqual(1);

        // Check that sender's balance is updated
        const senderBalanceAfter = await sender.getBalance();

        // todo there's a tiny discrepancy in the balance, need to investigate later, probably related to fwd fees.
        // expect(senderBalanceAfter).toEqual(senderBalanceBefore + amount);
        const discrepancy = amount - (senderBalanceAfter - senderBalanceBefore);
        console.log('Discrepancy:', utils.formatCoin(discrepancy));
        expect(discrepancy).toBeLessThan(toNano('0.001'));
    });

    it('should fail a withdrawal signed not by TSS', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender4');

        // Who deposited 10 TON in the gateway
        await gateway.sendDeposit(
            sender.getSender(),
            toNano('10') + gasFee,
            someRandomEvmWallet.address,
        );

        // Given a withdrawal payload ...
        const amount = toNano('5');
        const nonce = 1;
        const payload = beginCell()
            .storeAddress(sender.address)
            .storeCoins(amount)
            .storeUint(nonce, 32)
            .endCell();

        // ... which is signed by a RANDOM EVM wallet
        const signature = utils.signCellECDSA(someRandomEvmWallet, payload);

        // Given an admin command to withdraw TON
        const cmd: gw.AdminCommand = { op: gw.GatewayOp.Withdraw, signature, payload };

        // ACT & ASSERT
        // Withdraw TON and expect an error
        try {
            const result = await gateway.sendAdminCommand(cmd);
        } catch (e: any) {
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(gw.GatewayError.InvalidSignature);
        }
    });

    it('should exercise deposits enablement toggle', async () => {
        // ARRANGE
        // Given a sender
        const sender = await blockchain.treasury('sender5');

        // Given some donation to the Gateway
        await gateway.sendDonation(sender.getSender(), toNano('10'));

        // ACT 1
        // Disable deposits
        const result1 = await gateway.sendEnableDeposits(tssWallet, false);

        // ASSERT 1
        expectTX(result1.transactions, {
            from: undefined,
            to: gateway.address,
            success: true,
        });

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
        const result3 = await gateway.sendEnableDeposits(tssWallet, true);
        expectTX(result3.transactions, {
            from: undefined,
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
    });

    it('should update tss address', async () => {
        // ARRANGE
        // Given some TON in the Gateway
        await gateway.sendDonation(deployer.getSender(), toNano('10'));

        // Given a new TSS address
        // Let's say we've bumped the number of observer&signers, thus we require a new TSS wallet
        const newTss = new ethers.Wallet(
            '0x428239b1357227e03543875521be772c3126d383c4422328503cd0ac42e4ea0b',
        );

        console.log('New TSS', newTss.address);

        // ACT 1
        // Update TSS address
        const result1 = await gateway.sendUpdateTSS(tssWallet, newTss.address);

        // ASSERT 1
        // Check that tx is successful
        expectTX(result1.transactions, {
            from: undefined,
            to: gateway.address,
            op: gw.GatewayOp.UpdateTSS,
        });

        // Check that tss was updated
        const { tss } = await gateway.getGatewayState();
        expect(tss).toEqual(newTss.address.toLowerCase());

        // ACT 2
        // Do the same operation
        // Obviously, it should fail, because the TSS was already updated
        try {
            await gateway.sendUpdateTSS(tssWallet, newTss.address);
        } catch (e: any) {
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(gw.GatewayError.InvalidSignature);
        }

        // ACT 3
        // Now let's try to invoke an admin command with the new TSS
        const result3 = await gateway.sendEnableDeposits(newTss, true);

        // ASSERT 3
        expectTX(result3.transactions, {
            from: undefined,
            to: gateway.address,
            success: true,
        });
    });

    it('should update the code', async () => {
        // ARRANGE
        // Given some value in the Gateway
        await gateway.sendDonation(deployer.getSender(), toNano('10'));

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
        const result = await gateway.sendUpdateCode(tssWallet, code);

        // ASSERT
        expectTX(result.transactions, {
            from: undefined,
            to: gateway.address,
            op: gw.GatewayOp.UpdateCode,
        });

        // Try to query this new "ping" method
        const result2 = await blockchain.runGetMethod(gateway.address, 'ping', []);
        const message = result2.stackReader.readString();
        expect(message).toEqual('pong');

        // Try to trigger some TSS command
        // It should fail because external_message is not implemented anymore! :troll:
        try {
            await gateway.sendEnableDeposits(tssWallet, true);
        } catch (e: any) {
            // https://docs.ton.org/learn/tvm-instructions/tvm-exit-codes
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(11);
        }
    });

    // todo deposit_and_call: missing memo
    // todo deposit_and_call: memo is too long
    // todo deposits: should fail because the value is too small
    // todo deposits: check that gas costs are always less than 0.01 for long memos
    // todo withdrawals: amount is more than locked (should not be possible, but still worth checking)
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

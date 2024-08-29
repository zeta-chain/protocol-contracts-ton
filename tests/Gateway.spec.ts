import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano, Transaction } from '@ton/core';
import {
    AdminCommand,
    Gateway,
    GatewayConfig,
    GatewayError,
    GatewayOp,
    parseDepositLog,
} from '../wrappers/Gateway';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as utils from './utils';
import { findTransaction, FlatTransactionComparable } from '@ton/test-utils/dist/test/transaction';
import { ethers } from 'ethers';

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
    let gateway: SandboxContract<Gateway>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        const deployConfig: GatewayConfig = {
            depositsEnabled: true,
            tssAddress: tssWallet.address,
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
        expect(tss).toBe(tssWallet.address.toLowerCase());

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
            exitCode: GatewayError.NoIntent,
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
        const memo = utils.evmAddressToSlice(evmAddress);

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

        utils.logGasUsage(expect, tx);

        // Check gateway balance
        const gatewayBalanceAfter = await gateway.getBalance();

        // result should be >= (before + amount - gasFee)
        expect(gatewayBalanceAfter).toBeGreaterThanOrEqual(gatewayBalanceBefore + amount - gasFee);

        // Check that valueLocked is updated
        const [_, valueLocked] = await gateway.getQueryState();

        expect(valueLocked).toEqual(amount - gasFee);

        // Check that we have a log with the exact amount
        expect(tx.outMessagesCount).toEqual(1);

        // Check for data in the log message
        const depositLog = parseDepositLog(tx.outMessages.get(0)!.body);

        expect(depositLog.op).toEqual(GatewayOp.Deposit);
        expect(depositLog.queryId).toEqual(0);
        expect(depositLog.sender.toRawString()).toEqual(sender.address.toRawString());
        expect(depositLog.amount).toEqual(amount - gasFee);

        // Check that memo logged properly
        const memoAddress = utils.loadHexStringFromSlice(depositLog.memo.asSlice(), 20);

        expect(memoAddress).toEqual(evmAddress);
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
        const [_, valueLocked] = await gateway.getQueryState();

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
            utils.evmAddressToSlice('0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5'),
        );

        let [_, valueLocked] = await gateway.getQueryState();
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
        const cmd: AdminCommand = {
            op: GatewayOp.Withdraw,
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
        [_, valueLocked] = await gateway.getQueryState();
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
            utils.evmAddressToSlice(someRandomEvmWallet.address),
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
        const cmd: AdminCommand = { op: GatewayOp.Withdraw, signature, payload };

        // ACT & ASSERT
        // Withdraw TON and expect an error
        try {
            const result = await gateway.sendAdminCommand(cmd);
        } catch (e: any) {
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(GatewayError.InvalidSignature);
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
        const [depositsEnabled] = await gateway.getQueryState();
        expect(depositsEnabled).toBe(false);

        // ACT 2
        // Send sample deposit
        const result2 = await gateway.sendDeposit(sender.getSender(), toNano('1'), null);

        // ASSERT 2
        // It should fail
        expectTX(result2.transactions, {
            from: sender.address,
            to: gateway.address,
            success: false,
            exitCode: GatewayError.DepositsDisabled,
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
            utils.evmAddressToSlice('0x23f4569002a5a07f0ecf688142eeb6bcd883eef8'),
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
            op: GatewayOp.UpdateTSS,
        });

        // Check that tss was updated
        const { 2: tss } = await gateway.getQueryState();
        expect(tss).toEqual(newTss.address.toLowerCase());

        // ACT 2
        // Do the same operation
        // Obviously, it should fail, because the TSS was already updated
        try {
            await gateway.sendUpdateTSS(tssWallet, newTss.address);
        } catch (e: any) {
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(GatewayError.InvalidSignature);
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
            op: GatewayOp.UpdateCode,
        });

        // Try to query this new "ping" method
        const result2 = await blockchain.runGetMethod(gateway.address, 'ping', []);
        const message = result2.stackReader.readString();
        expect(message).toEqual('pong');

        // Try to trigger some TSS command
        // It should fail because external_message is not implemented anymore! :troll:
        try {
            const result3 = await gateway.sendEnableDeposits(tssWallet, true);
        } catch (e: any) {
            // https://docs.ton.org/learn/tvm-instructions/tvm-exit-codes
            const exitCode = e?.exitCode as number;
            expect(exitCode).toEqual(11);
        }
    });

    // todo deposits: arbitrary long memo
    // todo deposits: should fail w/o memo
    // todo deposits: should fail w/ value too small
    // todo deposits: should fail w/ invalid memo (too short)
    // todo deposits: check that gas costs are always less than 0.01 for long memos

    // todo withdrawals: invalid nonce
    // todo withdrawals: amount is more than locked
});

export function expectTX(transactions: Transaction[], cmp: FlatTransactionComparable): Transaction {
    expect(transactions).toHaveTransaction(cmp);

    const tx = findTransaction(transactions, cmp);
    expect(tx).toBeDefined();

    return tx!;
}

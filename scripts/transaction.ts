import { NetworkProvider } from '@ton/blueprint';
import { OpenedContract, Sender, SendMode, toNano } from '@ton/core';
import { ethers } from 'ethers';
import { Gateway } from '../wrappers/Gateway';
import * as types from '../types';
import * as crypto from '../crypto/ecdsa';
import * as common from './common';
import { formatCoin } from '../types';

async function open(p: NetworkProvider): Promise<OpenedContract<Gateway>> {
    const gwAddress = await common.inputGateway(p);
    const gw = Gateway.createFromAddress(gwAddress);

    const isDeployed = await p.isContractDeployed(gw.address);
    if (!isDeployed) {
        console.log(`Gateway is is not deployed to ${p.network()} network`);
    }

    return p.open(gw);
}

// Execute a Gateway command
export async function run(p: NetworkProvider) {
    const isTestnet = p.network() === 'testnet';

    let sender = p.sender();

    // replace ton wallet with mock sender that simply echoes tx data
    // for further manual tx sending
    const prepareTx = process.env.PREPARE_TX === 'true';
    if (prepareTx) {
        common.clogInfo('Prepare: using EchoSender');
        sender = new common.EchoSender(isTestnet, true);
    }

    const gw = await open(p);

    const cmd = await selectCommand(p, [
        'deposit',
        'depositAndCall',
        'call',
        'donate',
        'send',
        'withdraw',
        'increaseSeqno',
        'getState',
        'getSeqno',
        'authority',
    ]);

    switch (cmd) {
        case 'deposit':
            return await deposit(p, sender, gw);
        case 'depositAndCall':
            return await depositAndCall(p, sender, gw);
        case 'call':
            return await call(p, sender, gw);
        case 'donate':
            return await donate(p, sender, gw);
        case 'send':
            return await send(p, sender, gw);
        case 'withdraw':
            return await withdraw(p, gw);
        case 'increaseSeqno':
            return await increaseSeqno(p, gw);
        case 'authority':
            return await authorityCommand(p, sender, gw);
        default:
            console.log(`Unknown command ${cmd}`);
            return;
    }
}

// Gateway commands ===========================================

async function deposit(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const recipient = await ask(p, 'enter zevm recipient address', '');
    const amount = await ask(p, 'enter amount to deposit', '1');

    await gw.sendDeposit(sender, toNano(amount), recipient);
}

async function depositAndCall(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const recipient = await ask(p, 'enter zevm recipient address', '');
    const amount = await ask(p, 'enter amount to deposit', '1');

    const callDataRaw = await ask(p, 'enter ABI-encoded call data (e.g. 0x0000ABC123...)', '');
    const callData = types.hexStringToCell(callDataRaw);

    await gw.sendDepositAndCall(sender, toNano(amount), recipient, callData);
}

async function call(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const recipient = await ask(p, 'enter zevm recipient address', '');

    const callDataRaw = await ask(p, 'enter ABI-encoded call data (e.g. 0x0000ABC123...)', '');
    const callData = types.hexStringToCell(callDataRaw);

    await gw.sendCall(sender, recipient, callData);
}

async function donate(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const amount = await ask(p, 'enter amount to donate', '1');

    await gw.sendDonation(sender, toNano(amount));
}

// note the Gateway will bounce a tx w/o known op code
async function send(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const amount = await ask(p, 'enter amount to send', '1');

    await sender.send({
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        to: gw.address,
        value: toNano(amount),
    });
}

// TSS commands ===========================================
// (use only in localnet)

// Emulates withdrawals from the Gateway made by TSS ECDSA signature
async function withdraw(p: NetworkProvider, gw: OpenedContract<Gateway>) {
    const wallet = await resolveEVMWallet(p);
    const gwState = await gw.getGatewayState();

    if (wallet.address.toLowerCase() !== gwState.tss.toLowerCase()) {
        console.log(`Signer (${wallet.address}) doesn't match TSS (${gwState.tss})`);
        console.log('Aborting');
        return;
    }

    const recipient = await p.ui().inputAddress('Enter TON recipient', p.sender().address);
    const amount = await ask(p, 'Enter amount to withdraw', '1');

    const signer = crypto.signerFromEthersWallet(wallet);
    await gw.sendWithdraw(signer, recipient, toNano(amount));

    console.log('Sent an external message to the Gateway');
    console.log(`Checkout ${gw.address.toRawString()} in the explorer to see the result`);
}

async function increaseSeqno(p: NetworkProvider, gw: OpenedContract<Gateway>) {
    const wallet = await resolveEVMWallet(p);
    const gwState = await gw.getGatewayState();

    if (wallet.address.toLowerCase() !== gwState.tss.toLowerCase()) {
        console.log(`Signer (${wallet.address}) doesn't match TSS (${gwState.tss})`);
        console.log('Aborting');
        return;
    }

    const reasonCode = await common.inputNumber(p, 'enter reason code', 0);

    const signer = crypto.signerFromEthersWallet(wallet);
    await gw.sendIncreaseSeqno(signer, reasonCode);

    console.log('Sent an external message to the Gateway');
    console.log(`Checkout ${gw.address.toRawString()} in the explorer to see the result`);
}

// Authority commands ===========================================

async function authorityCommand(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const cmd = await selectCommand(p, [
        'enableDeposits',
        'updateTSS',
        'resetSeqno',
        'updateAuthority',
    ]);

    switch (cmd) {
        case 'enableDeposits':
            return await enableDeposits(p, sender, gw);
        case 'updateTSS':
            return await updateTSS(p, sender, gw);
        case 'resetSeqno':
            return await resetSeqno(p, sender, gw);
        case 'updateAuthority':
            return await updateAuthority(p, sender, gw);
        default:
            console.log(`Unknown authority command ${cmd}`);
            return;
    }
}

async function enableDeposits(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const enabled = await p.ui().prompt('Set deposits enabled? Otherwise, will be disabled');

    await gw.sendEnableDeposits(sender, enabled);
}

async function updateTSS(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const tss = await common.inputString(p, 'Enter new TSS address', '');

    await gw.sendUpdateTSS(sender, tss);
}

async function resetSeqno(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const seqno = await common.inputNumber(p, 'Enter new seqno', 0);

    await gw.sendResetSeqno(sender, seqno);
}

async function updateAuthority(p: NetworkProvider, sender: Sender, gw: OpenedContract<Gateway>) {
    const authority = await p.ui().inputAddress('Enter new authority address');

    await gw.sendUpdateAuthority(sender, authority);
}

// Helper commands ===========================================

async function selectCommand(p: NetworkProvider, commands: string[]): Promise<string> {
    return await p.ui().choose('Select command', commands, (cmd) => cmd);
}

async function resolveEVMWallet(p: NetworkProvider): Promise<ethers.Wallet> {
    let pk = process.env.EVM_PK as string;

    if (!pk) {
        const warning =
            'You are about to enter a private key emulating TSS. ' +
            'NEVER USE THIS FOR REAL FUNDS. Proceed?';

        await ack(p, warning);

        pk = await ask(p, 'Enter a private key', '');
    } else {
        console.log('Loaded EVM private key from env ✔︎');
    }

    const wallet = new ethers.Wallet(pk);

    console.log(`Signer address: ${wallet.address}`);

    return wallet;
}

async function ask(p: NetworkProvider, msg: string, defaultValue: string): Promise<string> {
    const v = await p.ui().input(`${msg} [default: '${defaultValue}']`);

    return v !== '' ? v.trim() : defaultValue;
}

async function ack(p: NetworkProvider, msg: string): Promise<void> {
    const ok = await p.ui().prompt(msg);
    if (!ok) {
        throw new Error('cancelled');
    }
}

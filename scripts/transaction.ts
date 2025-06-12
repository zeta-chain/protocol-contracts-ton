import { NetworkProvider } from '@ton/blueprint';
import { OpenedContract, SendMode, toNano } from '@ton/core';
import { ethers } from 'ethers';
import { formatCoin } from '../tests/utils';
import { Gateway } from '../wrappers/Gateway';
import * as types from '../types';
import * as crypto from '../crypto/ecdsa';
import * as common from './common';

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
    const gw = await open(p);

    // can be extended in the future
    const commands = [
        'deposit',
        'depositAndCall',
        'donate',
        'send',
        'withdraw',
        'getState',
        'getSeqno',
    ];

    const cmd = await p.ui().choose('Select command', commands, (cmd) => cmd);

    switch (cmd) {
        case 'deposit':
            return await deposit(p, gw);
        case 'depositAndCall':
            return await depositAndCall(p, gw);
        case 'donate':
            return await donate(p, gw);
        case 'send':
            return await send(p, gw);
        case 'withdraw':
            return await withdraw(p, gw);
        case 'getState':
            const state = await gw.getGatewayState();
            console.log('Gateway state', {
                depositsEnabled: state.depositsEnabled,
                valueLocked: formatCoin(state.valueLocked),
                tss: state.tss,
                authority: state.authority.toRawString(),
            });
            return;
        case 'getSeqno':
            console.log('Gateway seqno:', await gw.getSeqno());
            return;
        default:
            console.log(`Unknown command ${cmd}`);
            return;
    }
}

async function deposit(p: NetworkProvider, gw: OpenedContract<Gateway>) {
    const recipient = await ask(p, 'enter zevm recipient address', '');
    const amount = await ask(p, 'enter amount to deposit', '1');

    await gw.sendDeposit(p.sender(), toNano(amount), recipient);
}

async function depositAndCall(p: NetworkProvider, gw: OpenedContract<Gateway>) {
    const recipient = await ask(p, 'enter zevm recipient address', '');
    const amount = await ask(p, 'enter amount to deposit', '1');

    const callDataRaw = await ask(p, 'enter ABI-encoded call data (e.g. 0x0000ABC123...)', '');
    const callData = types.hexStringToCell(callDataRaw);

    await gw.sendDepositAndCall(p.sender(), toNano(amount), recipient, callData);
}

async function donate(p: NetworkProvider, gw: OpenedContract<Gateway>) {
    const amount = await ask(p, 'enter amount to donate', '1');

    await gw.sendDonation(p.sender(), toNano(amount));
}

// note the Gateway will bounce a tx w/o known op code
async function send(p: NetworkProvider, gw: OpenedContract<Gateway>) {
    const amount = await ask(p, 'enter amount to send', '1');

    await p.sender().send({
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        to: gw.address,
        value: toNano(amount),
    });
}

// Emulates withdrawals from the Gateway made by TSS ECDSA signature
async function withdraw(p: NetworkProvider, gw: OpenedContract<Gateway>) {
    await ack(
        p,
        'You are about to enter a private key emulating TSS. ' +
            'NEVER USE THIS FOR REAL FUNDS. Proceed?',
    );

    const wallet = new ethers.Wallet(await ask(p, 'Enter a private key', ''));

    const gwState = await gw.getGatewayState();
    if (wallet.address.toLowerCase() !== gwState.tss.toLowerCase()) {
        console.log(`Signer (${wallet.address}) doesn't match TSS (${gwState.tss})`);
        console.log('Aborting');
        return;
    }

    console.log(`Signer address: ${wallet.address}`);

    const recipient = await p.ui().inputAddress('Enter TON recipient', p.sender().address);
    const amount = await ask(p, 'Enter amount to withdraw', '1');

    const signer = crypto.signerFromEthersWallet(wallet);
    await gw.sendWithdraw(signer, recipient, toNano(amount));

    console.log('Sent an external message to the Gateway');
    console.log(`Checkout ${gw.address.toRawString()} in the explorer to see the result`);
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

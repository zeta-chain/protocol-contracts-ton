import { NetworkProvider } from '@ton/blueprint';
import { Gateway } from '../wrappers/Gateway';
import * as common from './common';
import { CommonMessageInfoInternal, fromNano, OpenedContract, Transaction } from '@ton/core';
import { TonClient } from '@ton/ton';
import { bufferToHexString, depositLogFromCell, GatewayOp, sliceToHexString } from '../types';

let isTestnet = false;

export async function run(provider: NetworkProvider) {
    const client = resolveClient(provider);

    isTestnet = provider.network() === 'testnet';

    const gwAddress = await common.inputGateway(provider);

    const gw = await provider.open(Gateway.createFromAddress(gwAddress));

    const commands: Record<string,string> = {
        'specific-tx': 'Explore specific transaction',
        'last-txs': 'List last 10 transactions',
    };

    const cmd = await provider.ui().choose(
        'Select command',
        Object.keys(commands),
        cmd => commands[cmd]
    );


    if (cmd === 'last-txs') {
        await suppressException(async () => await fetchLastTransactions(client, gw));
        return;
    }

    await suppressException(async () => {
        const txHash = await provider.ui().input(`Enter transaction in a format <lt>:<hash>`);
        await fetchTransaction(client, gw, txHash);
    });
}

async function fetchLastTransactions(client: TonClient, gw: OpenedContract<Gateway>) {
    // todo
    console.log('Fetching last transactions...');
}

async function fetchTransaction(client: TonClient, gw: OpenedContract<Gateway>, txHash: string) {
    const { lt, hash } = common.parseTxHash(txHash);

    let tx: Transaction | null = null;

    try {
        tx = await client.getTransaction(gw.address, lt, hash);
    } catch (error) {
        console.error("getTransaction", error);
        return
    }

    if (tx === null) {
        console.error(`Transaction "${txHash}" not found`);
        return;
    }

    const parsed = parseTransaction(tx, gw);

    console.log('Transaction details', parsed);
}

function resolveClient(provider: NetworkProvider): TonClient {
    const api = provider.api();

    if (api instanceof TonClient) {
        return api;
    }

    throw new Error('API is not a TonClient instance');
}

async function suppressException(fn: () => Promise<void>) {
    try {
        await fn();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
    }
}

function parseTransaction(tx: Transaction, gw: OpenedContract<Gateway>) {
    return tx.inMessage?.info.type === 'internal'
        ? parseInbound(tx, gw)
        : parseOutbound(tx, gw);
}

function parseInbound(tx: Transaction, gw: OpenedContract<Gateway>) {
    const info = tx.inMessage!.info as CommonMessageInfoInternal;
    const hash = tx.hash().toString('hex');

    let kv: Record<string, any> = {};

    const slice = tx.inMessage!.body.beginParse()
    const opCode = slice.loadUint(32);

    switch (opCode) {
        case GatewayOp.Donate:
            kv.operation = 'donate';
            kv.queryId = slice.loadUint(64);

            break;
        case GatewayOp.Deposit:
            kv.operation = 'deposit';
            kv.queryId = slice.loadUint(64);
            kv.zevmRecipient = bufferToHexString(slice.loadBuffer(20));

            const outDeposit = depositLogFromCell(tx.outMessages.get(0)!.body);
            kv.depositAmount = formatCoin(outDeposit.amount);
            kv.depositFee = formatCoin(outDeposit.depositFee);

            break;
        case GatewayOp.DepositAndCall:
            kv.operation = 'deposit_and_call';
            kv.queryId = slice.loadUint(64);
            kv.zevmRecipient = bufferToHexString(slice.loadBuffer(20));
            kv.callData = sliceToHexString(slice.loadRef().asSlice());

            const outDepositAndCall = depositLogFromCell(tx.outMessages.get(0)!.body);
            kv.depositAmount = formatCoin(outDepositAndCall.amount);
            kv.depositFee = formatCoin(outDepositAndCall.depositFee);

            break;
        default:
            kv.operation = `unknown (op: ${opCode})`;
    }

    return {
        sender: info.src.toRawString(),
        receiver: info.dest.toRawString(),
        hash: `${tx.lt}:${hash}`,
        timestamp: formatDate(tx.now),
        txAmount: formatCoin(info.value.coins),
        gas: formatCoin(tx.totalFees.coins),
        link: common.txLink(hash, isTestnet),
        payload: kv,
    }
}

function parseOutbound(tx: Transaction, gw: OpenedContract<Gateway>) {
    // todo
    return {}
}

function formatDate(at: number) {
    return new Date(at * 1000).toISOString();
}

function formatCoin(amount: bigint) {
    return `${fromNano(amount)} TON`;
}


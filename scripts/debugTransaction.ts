import { NetworkProvider } from '@ton/blueprint';
import { Gateway } from '../wrappers/Gateway';
import * as common from './common';
import {
    CommonMessageInfoExternalIn,
    CommonMessageInfoInternal,
    fromNano,
    OpenedContract,
    Transaction,
    TransactionComputePhase,
    TransactionDescriptionGeneric,
} from '@ton/core';
import { TonClient } from '@ton/ton';
import {
    bufferToHexString,
    DepositLog,
    depositLogFromCell,
    GatewayOp,
    sliceToHexString,
} from '../types';

let isTestnet = false;

export async function run(provider: NetworkProvider) {
    isTestnet = provider.network() === 'testnet';

    const client = resolveClient(provider);

    const gwAddress = await common.inputGateway(provider);
    const gw = await provider.open(Gateway.createFromAddress(gwAddress));

    const commands: Record<string, string> = {
        'recent-txs': 'List recent transactions',
        'specific-tx': 'Explore specific transaction',
    };

    const cmd = await provider
        .ui()
        .choose('Select command', Object.keys(commands), (cmd) => commands[cmd]);

    if (cmd === 'recent-txs') {
        const limit = await common.inputNumber(provider, 'Enter tx limit', 20);

        await suppressException(async () => await fetchLastTransactions(client, gw, limit));
        return;
    }

    await suppressException(async () => {
        const txHash = await provider.ui().input(`Enter transaction in a format <lt>:<hash>`);
        await fetchTransaction(client, gw, txHash);
    });
}

async function fetchLastTransactions(client: TonClient, gw: OpenedContract<Gateway>, limit = 10) {
    const txs = await client.getTransactions(gw.address, { limit, archival: true });

    const out: any[] = [];

    for (const tx of txs) {
        try {
            const parsed = parseTransaction(tx);
            out.push(parsed);
        } catch (error) {
            out.push({
                hash: tx.hash().toString('hex'),
                error: error instanceof Error ? error.message : error,
            });
        }
    }

    console.log(JSON.stringify(out, null, 2));
}

async function fetchTransaction(client: TonClient, gw: OpenedContract<Gateway>, txHash: string) {
    const { lt, hash } = common.parseTxHash(txHash);

    let tx: Transaction | undefined;

    try {
        const txs = await client.getTransactions(gw.address, {
            limit: 1,
            lt,
            hash,
            inclusive: true,
            archival: true,
        });
        if (txs.length === 0) {
            console.error(`Transaction "${txHash}" not found`);
            return;
        }

        tx = txs[0];
    } catch (error) {
        console.error('getTransactions', error);
        return;
    }

    const parsed = parseTransaction(tx);

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

function parseTransaction(tx: Transaction) {
    return tx.inMessage?.info.type === 'internal' ? parseInbound(tx) : parseOutbound(tx);
}

function parseInbound(tx: Transaction) {
    const info = tx.inMessage!.info as CommonMessageInfoInternal;
    const hash = tx.hash().toString('hex');
    const exitCode = (tx.description as any).computePhase!.exitCode as number;
    const success = exitCode === 0;

    const parseLog = (): DepositLog => {
        if (!success) {
            return { amount: 0n, depositFee: 0n };
        }

        const body = tx.outMessages.get(0)!.body;

        return depositLogFromCell(body);
    };

    let kv: Record<string, any> = {};

    const slice = tx.inMessage!.body.beginParse();
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

            const depositLog = parseLog();
            kv.depositAmount = formatCoin(depositLog.amount);
            kv.depositFee = formatCoin(depositLog.depositFee);

            break;
        case GatewayOp.DepositAndCall:
            kv.operation = 'deposit_and_call';
            kv.queryId = slice.loadUint(64);
            kv.zevmRecipient = bufferToHexString(slice.loadBuffer(20));
            kv.callData = sliceToHexString(slice.loadRef().asSlice());

            const dacLog = parseLog();
            kv.depositAmount = formatCoin(dacLog.amount);
            kv.depositFee = formatCoin(dacLog.depositFee);

            break;
        case GatewayOp.Call:
            kv.operation = 'call';
            kv.queryId = slice.loadUint(64);
            kv.zevmRecipient = bufferToHexString(slice.loadBuffer(20));
            kv.callData = sliceToHexString(slice.loadRef().asSlice());

            break;
        default:
            kv.operation = `unknown (op: ${opCode})`;
    }

    return {
        sender: info.src.toRawString(),
        receiver: info.dest.toRawString(),
        hash: `${tx.lt}:${hash}`,
        timestamp: formatDate(tx.now),
        exitCode: exitCode,
        txAmount: formatCoin(info.value.coins),
        gas: formatCoin(tx.totalFees.coins),
        link: common.txLink(hash, isTestnet),
        payload: kv,
    };
}

function parseOutbound(tx: Transaction) {
    const info = tx.inMessage!.info as CommonMessageInfoExternalIn;
    const hash = tx.hash().toString('hex');
    const exitCode = (tx.description as any).computePhase!.exitCode as number;

    const slice = tx.inMessage!.body.beginParse();

    // [V, R, S]
    const signature = slice.loadBuffer(1 + 32 + 32);

    const payload = slice.loadRef().beginParse();

    const opCode = payload.loadUint(32);

    let kv: Record<string, any> = {};

    switch (opCode) {
        case GatewayOp.Withdraw:
            const recipient = payload.loadAddress();
            const amount = payload.loadCoins();
            const seqno = payload.loadUint(32);

            kv = {
                operation: 'withdraw',
                signature: `0x${signature.toString('hex')}`,
                recipient: recipient.toRawString(),
                amount: formatCoin(amount),
                seqno,
            };

            break;
        case GatewayOp.IncreaseSeqno:
            const reasonCode = payload.loadUint(32);
            const seqno2 = payload.loadUint(32);

            kv = {
                operation: 'increaseSeqno',
                signature: `0x${signature.toString('hex')}`,
                reasonCode,
                seqno: seqno2,
            };

            break;
        default:
            kv.operation = `unknown (op: ${opCode})`;
    }

    return {
        sender: null, // external messages don't have a sender
        receiver: info.dest.toRawString(),
        hash: `${tx.lt}:${hash}`,
        timestamp: formatDate(tx.now),
        exitCode: exitCode,
        gas: formatCoin(tx.totalFees.coins),
        link: common.txLink(hash, isTestnet),
        payload: kv,
    };
}

function formatDate(at: number) {
    return new Date(at * 1000).toISOString();
}

function formatCoin(amount: bigint) {
    return `${fromNano(amount)} TON`;
}

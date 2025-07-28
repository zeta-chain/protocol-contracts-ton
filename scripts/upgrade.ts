import { NetworkProvider } from '@ton/blueprint';
import { Address, beginCell, Cell, OpenedContract, toNano } from '@ton/core';
import { Gateway } from '../wrappers/Gateway';
import * as path from 'path';
import * as fs from 'fs';
import { cellFromBuffer, cellFromEncoded, formatCoin, GatewayState, GatewayOp } from '../types';
import { Blockchain, SendMessageResult } from '@ton/sandbox';
import {
    inputGateway,
    clog,
    clogInfo,
    inputString,
    addressLink,
    clogError,
    clogSuccess,
    EchoSender,
} from './common';
import { flattenTransaction } from '@ton/test-utils';

async function open(p: NetworkProvider, gwAddress: Address): Promise<OpenedContract<Gateway>> {
    const gw = Gateway.createFromAddress(gwAddress);

    const isDeployed = await p.isContractDeployed(gw.address);
    if (!isDeployed) {
        console.log(`Gateway is is not deployed to ${p.network()} network`);
    }

    return p.open(gw);
}

/**
 * Execute a Gateway upgrade with a dry run.
 * @param p NetworkProvider
 */
export async function run(p: NetworkProvider) {
    const isTestnet = p.network() === 'testnet';

    let sender = p.sender();

    // replace ton wallet with mock sender that simply echoes tx data
    // for further manual tx sending
    const prepareTx = process.env.PREPARE_TX === 'true';
    if (prepareTx) {
        clogInfo('Prepare: using EchoSender');
        sender = new EchoSender(isTestnet, true);
    }

    const gw = await open(p, await inputGateway(p));

    // 1. Load new code (it should contain .hex key with the code)
    clog('Provide a path to a compiled contract');

    const compiledPath = path.resolve(
        await inputString(p, 'Enter path', 'build/Gateway.compiled.json'),
    );

    clogInfo(`Reading compiled contract from ${compiledPath}`);

    const jsonObj = JSON.parse(fs.readFileSync(compiledPath, 'utf8'));
    const codeCell = cellFromEncoded(jsonObj.hex, 'hex');

    clogInfo('Contract code loaded ✅');
    clogInfo('Querying contract state ⏳');

    // 2. Check state
    const gwState = await gw.getGatewayState();
    console.log('Gateway state', {
        ...gwState,
        valueLocked: formatCoin(gwState.valueLocked),
        authority: gwState.authority.toRawString(),
    });

    // 3. Dry run the upgrade
    await dryRunUpgrade(p, gw, codeCell);

    // 4. Check authority
    if (!prepareTx && !gwState.authority.equals(sender.address!)) {
        clogError('You are not the authority of the Gateway!');
        clogError(`Your address: ${sender.address!.toRawString()}`);
        clogError(`Gateway authority: ${gwState.authority.toRawString()}`);
        process.exit(1);
    }

    // 5. Perform a real upgrade (skipped in prepare mode)
    if (!prepareTx) {
        const ok = await p.ui().prompt('Are you sure you want to upgrade the Gateway?');
        if (!ok) {
            console.log('Aborted');
            process.exit(0);
        }
    }

    await gw.sendUpdateCode(sender, codeCell);
    clogInfo(`Sent tx to the Gateway. Check ${addressLink(gw.address, isTestnet)}`);
}

/**
 * Performs a dry run of the upgrade
 * @param networkProvider - NetworkProvider
 * @param gwRemote - Deployed gateway on the network
 * @param newCode - Cell
 */
async function dryRunUpgrade(
    networkProvider: NetworkProvider,
    gwRemote: OpenedContract<Gateway>,
    newCode: Cell,
) {
    clogSuccess('Running a dry run of the upgrade 👾');
    clog('Downloading gateway state & code from the network');

    // 1. Download the contract with state
    const contractState = await networkProvider.api().provider(gwRemote.address).getState();

    if (contractState.state.type !== 'active') {
        throw new Error('contract is not active');
    } else if (!contractState.state.code) {
        throw new Error('contract code is not available');
    } else if (!contractState.state.data) {
        throw new Error('contract data is not available');
    }

    const currentCode = cellFromBuffer(contractState.state.code);
    const currentData = cellFromBuffer(contractState.state.data);

    // 2. Create local blockchain sandbox with the contract state
    clog('Creating a local blockchain sandbox');

    const sandbox = await Blockchain.create();

    // 2.1. Create a fake authority that will perform the upgrade
    // By doing so, we can avoid having a real signature for dry-run.
    // Also, we create a depositor that will perform a sample deposit.
    const [authority, depositor] = await Promise.all([
        sandbox.treasury('authority'),
        sandbox.treasury('depositor'),
    ]);

    clog('Setting up the contract state in the sandbox');

    await sandbox.setShardAccount(gwRemote.address, {
        lastTransactionHash: bigIntFromBuffer(contractState.last!.hash),
        lastTransactionLt: contractState.last!.lt,
        account: {
            addr: gwRemote.address,
            storageStats: {
                used: { cells: 1n, bits: BigInt(currentData.bits.length), publicCells: 0n },
                lastPaid: 0,
                duePayment: null,
            },
            storage: {
                lastTransLt: contractState.last!.lt + 1n,
                balance: { coins: contractState.balance },
                state: {
                    type: 'active',
                    state: {
                        code: currentCode,
                        data: mockState(currentData, {
                            newAuthority: authority.address,
                        }),
                    },
                },
            },
        },
    });

    clog('Ensuring sandbox setup');

    // 3. Run some sample get method on the contract to ensure it works locally
    const gwSandbox = sandbox.openContract(Gateway.createFromAddress(gwRemote.address));

    // check state matches
    let [remoteState, sandboxState] = await Promise.all([
        gwRemote.getGatewayState(),
        gwSandbox.getGatewayState(),
    ]);

    if (!statePartiallyEquals(remoteState, sandboxState)) {
        throw new Error(
            `State mismatch: ${JSON.stringify(remoteState)} != ${JSON.stringify(sandboxState)}`,
        );
    }

    // 4. Run the upgrade
    clog('Running a dry run of the upgrade ⏳');

    // 5. Verify the update code tx
    const txUpdate = extractResultTx(
        await gwSandbox.sendUpdateCode(authority.getSender(), newCode),
    );

    if (txUpdate.op !== GatewayOp.UpdateCode) {
        throw new Error(`Expected update_code tx, got ${txUpdate.op}`);
    } else if (!txUpdate.success) {
        throw new Error('Update code tx failed');
    }

    clog('Contract updated, verifying dry-run result');

    clog('Performing a sample deposit of 1 TON');

    // 5.1 Perform a sample deposit of 1 TON
    const zevmRecipient = '0x3863BeC603fD3a439fdF5996c714E8bB1AaEafaE';
    const amount = toNano(1);
    const txDeposit = extractResultTx(
        await gwSandbox.sendDeposit(depositor.getSender(), amount, zevmRecipient),
    );

    if (txDeposit.op !== GatewayOp.Deposit) {
        throw new Error(`Expected deposit tx, got ${txDeposit.op}`);
    } else if (!txDeposit.success) {
        throw new Error('Deposit tx failed');
    }

    // 5.2 Check getters
    sandboxState = await gwSandbox.getGatewayState();
    if (sandboxState.valueLocked <= remoteState.valueLocked) {
        throw new Error('Value locked should be greater than before');
    }

    clogSuccess('Dry run completed ✅');
}

function bigIntFromBuffer(buff: Buffer): bigint {
    return BigInt(`0x${buff.toString('hex')}`);
}

// doesn't check for authority address
function statePartiallyEquals(a: GatewayState, b: GatewayState): boolean {
    return (
        a.depositsEnabled === b.depositsEnabled &&
        a.valueLocked === b.valueLocked &&
        a.tss === b.tss
    );
}

/**
 * Modifies the state of the contract to have a new authority
 * @param original - original raw state
 * @param newAuthority - new authority address (admin wallet)
 * @returns Cell
 */
function mockState(original: Cell, state: { newAuthority: Address }): Cell {
    /*
        ;; state.fc
        () load_state() impure inline {
            var cs = get_data().begin_parse();

            state::deposits_enabled = cs~load_uint(size::deposits_enabled);
            state::total_locked = cs~load_coins();
            state::seqno = cs~load_uint(size::seqno);
            state::tss_address = cs~load_bits(size::evm_address);
            state::authority_address = cs~load_msg_addr();
        }
     */
    const modified = beginCell();
    const cs = original.beginParse();

    // Copy everything, but change the authority
    // 1 bit for deposits_enabled
    // 32 bits for seqno
    // 20 bytes for tss_address
    modified.storeUint(cs.loadUint(1), 1);
    modified.storeCoins(cs.loadCoins());
    modified.storeUint(cs.loadUint(32), 32);
    modified.storeBuffer(cs.loadBuffer(20));
    modified.storeAddress(state.newAuthority);

    return modified.asCell();
}

function extractResultTx(result: SendMessageResult) {
    if (result.transactions.length !== 2) {
        throw new Error('Expected 2 transactions, got ' + result.transactions.length);
    }

    const tx = result.transactions[1];

    return flattenTransaction(tx);
}

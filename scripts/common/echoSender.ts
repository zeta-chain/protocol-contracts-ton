import { Sender, SenderArguments } from '@ton/core';
import { clogInfo } from '.';
import { formatCoin } from '../../types';

/**
 * Sender mock that is suitable for printing the transaction details to console.
 * Can be used for manual raw transaction sending.
 */
export class EchoSender implements Sender {
    constructor(public readonly exitAfterSend: boolean = false) {}

    async send(args: SenderArguments): Promise<void> {
        clogInfo('[EchoSender] Use this data to send a transaction manually');

        let bodyBocBase64: string | null = null;
        if (args.body) {
            bodyBocBase64 = args.body.toBoc().toString('base64');
        }

        console.log('Transaction details', {
            recipient: args.to.toRawString(),
            value: `${formatCoin(args.value)} TON`,
            valueRaw: args.value.toString(),
            bodyBocBase64,
        });

        clogInfo('[EchoSender] No actual tx sent');
        if (this.exitAfterSend) {
            clogInfo('Exited');
            process.exit(0);
        }
    }
}

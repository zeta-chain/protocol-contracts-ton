import { Sender, SenderArguments } from '@ton/core';
import { clogInfo, clogSuccess } from '.';
import { formatCoin } from '../../types';

/**
 * Sender mock that is suitable for printing the transaction details to console.
 * Can be used for manual raw transaction sending.
 */
export class EchoSender implements Sender {
    constructor(
        public readonly isTestnet: boolean,
        public readonly exitAfterSend: boolean = false,
    ) {}

    public async send(args: SenderArguments): Promise<void> {
        clogInfo('[EchoSender] Use this data to send a transaction manually');

        let bodyBocBase64: string | null = null;
        if (args.body) {
            bodyBocBase64 = args.body.toBoc().toString('base64');
        }

        const tx = {
            recipient: {
                raw: args.to.toRawString(),
                formatted: args.to.toString({
                    bounceable: false,
                    testOnly: this.isTestnet,
                }),
            },
            amount: {
                raw: args.value.toString(),
                formatted: `${formatCoin(args.value)} TON`,
            },
            bodyBocBase64,
        };

        console.log('[EchoSender] Transaction details:', tx);

        const message = `[EchoSender] No actual tx sent${this.exitAfterSend ? '. Exit 0' : ''}`;
        clogSuccess(message);

        if (this.exitAfterSend) {
            process.exit(0);
        }
    }
}

import { hexStringToCell, sliceToHexString } from './utils';

const text =
    'Lorem Ipsum is simply dummy text of the printing and typesetting industry.' +
    " Lorem Ipsum has been the industry's standard dummy text ever since the 1500s," +
    ' when an unknown printer took a galley of type and scrambled it to make a type specimen book.';

describe('utils', () => {
    it('should convert a text string to a hex string', () => {
        // ARRANGE
        // Given a text string in a hex format
        const from = textToHexString(text);

        // ACT
        // Convert it into a BOC
        const cell = hexStringToCell(from);

        // ASSERT
        // Convert cell back to hex string
        const to = sliceToHexString(cell.beginParse());

        expect(to).toBe(from);

        // And convert it back to a text string
        const text2 = hexStringToText(from);
        expect(text2).toBe(text);
    });
});

function textToHexString(text: string): string {
    const buffer = Buffer.from(text, 'utf-8');

    return `0x${buffer.toString('hex')}`;
}

// "0x..." -> text"
function hexStringToText(hex: string): string {
    return Buffer.from(hex.substring(2), 'hex').toString('utf-8');
}

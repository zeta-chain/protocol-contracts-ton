import { beginCell, Cell, Slice } from '@ton/core';
import { ethers } from 'ethers';

/**
 * Signs a cell with secp256k1 signature into a Slice (65 bytes)
 * @param signer
 * @param cell
 */
export function ecdsaSignCell(signer: ethers.Wallet, cell: Cell): Slice {
    const hash = cell.hash();
    const sig = signer.signingKey.sign(hash);

    // https://docs.ton.org/learn/tvm-instructions/instructions
    //
    // `ECRECOVER` Recovers public key from signature...
    // Takes 32-byte hash as uint256 hash; 65-byte signature as uint8 v and uint256 r, s.
    const [v, r, s] = [Number(sig.v), BigInt(sig.r), BigInt(sig.s)];

    return beginCell().storeUint(v, 8).storeUint(r, 256).storeUint(s, 256).asSlice();
}

import { beginCell, Cell, Slice } from '@ton/core';
import { ethers } from 'ethers';

// Arbitrary signer
export type Signer = (hash: Buffer) => { v: number; r: string; s: string };

/**
 * Creates a signer from an ethers.js wallet
 * @param wallet - ethers.js wallet
 * @returns Signer
 */
export function signerFromEthersWallet(wallet: ethers.Wallet): Signer {
    return (hash: Buffer) => {
        const sig = wallet.signingKey.sign(hash);

        return {
            v: Number(sig.v),
            r: sig.r,
            s: sig.s,
        };
    };
}

/**
 * Signs a cell with secp256k1 signature into a Slice (65 bytes)
 * @param signer
 * @param cell
 */
export function ecdsaSignCell(signer: Signer, cell: Cell): Slice {
    const sig = signer(cell.hash());

    // https://docs.ton.org/learn/tvm-instructions/instructions
    //
    // `ECRECOVER` Recovers public key from signature...
    // Takes 32-byte hash as uint256 hash; 65-byte signature as uint8 v and uint256 r, s.
    const [v, r, s] = [Number(sig.v), BigInt(sig.r), BigInt(sig.s)];

    return beginCell().storeUint(v, 8).storeUint(r, 256).storeUint(s, 256).asSlice();
}

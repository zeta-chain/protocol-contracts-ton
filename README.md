# ZetaChain TON Protocol Contracts

Contracts of official protocol contracts deployed by the core ZetaChain team to facilitate cross-chain
operations using TON (The Open Network) and other chains.

## Supported operations

- `deposit` - deposit TON to the Gateway contract
- `deposit_and_call` - deposit TON to the Gateway contract and call a contract on the EVM side
- `withdraw` - withdraw TON from the Gateway contract

## ⚠️ Important Notice

This repository is under active development and is not yet ready for production use.

## Learn more about ZetaChain

* Check our [website](https://www.zetachain.com/).
* Read our [docs](https://docs.zetachain.com/).

## Project structure

The project is built using [Blueprint](https://github.com/ton-org/blueprint).

- `contracts` - source code of all the smart contracts of the project and their dependencies.
- `wrappers` - wrapper classes (implementing `Contract` from ton-core) for the contracts, including any [de]
  serialization primitives and compilation functions.
- `tests` - tests for the contracts.
- `scripts` - scripts used by the project, mainly the deployment scripts.

## How to use

- Compile FunC contracts: `make compile` — compiles all smart contracts written in FunC.
- Run tests: `make test` — executes the unit tests for the contracts.
- Deploy contract: `make deploy`
- Send different transactions to the contract — `make tx`

## How it works

### Deposits

All deposits are represented as internal messages that have the following structure:

- uint32 `op_code` - operation code. Standard for TON
- uint64 `query_id` - not used right now. Standard for TON
- ... the rest of the message is the operation-specific data

#### `deposit` (op 101)

```
op_code:uint32 query_id:uint64 evm_recipient:slice (160 bits)
```

Deposits funds to the contract (subtracting a small deposit fee to cover the gas costs).
ZetaChain will observe this tx and execute cross-chain deposit to `evm_recipient` on Zeta.

#### `deposit_and_call` (op 102)

```
op_code:uint32 query_id:uint64 evm_recipient:slice (160 bits) call_data:cell
```

Deposits funds to the contract (subtracting a small deposit fee to cover the gas costs).
ZetaChain will observe this tx and execute cross-chain deposit to `evm_recipient` on Zeta
AND call the contract with `call_data`.

Note that `call_data` should be
encoded as [snakeCell](https://docs.ton.org/develop/dapps/asset-processing/metadata#snake-data-encoding)

#### Authority operations

These "admin" operations are used to manage the contract. In the future, they will be fully managed by TSS.
Currently, a dedicated authority address is used `state::authority_address`

- `set_deposits_enabled` - toggle deposits
- `update_tss` - update TSS public key
- `update_code` - upgrade the contract code
- `update_authority` - update the authority TON address

### Withdrawals

ZetaChain uses MPC (Multi Party Computation) to sign all outbound transactions using TSS (Threshold Signature Scheme).
Due to the technical implementation TSS uses ECDSA cryptography in opposite to EdDSA in TON.
Thus, the contract must verify ECDSA signatures directly on-chain.

All TSS commands are represented as external messages that have the following structure:

- `[65]byte signature` - ECDSA signature of the message hash (v, r, s)
- `cell ref payload` - Message payload
    - `uint32 op_code` - operation code
    - the rest of the payload is the operation-specific data...

By having this structure we can sign arbitrary messages using ECDSA, recover signature,
then ensure sender and proceed with the operation.

The payload for `op withdrawal (200)` is the following:

```
op:uint32 recipient:MsgAddr amount:Coins seqno:uint32
```

#### External message signature flow:

1. Calculate the hash of the payload cell: `payload_hash` = `sha256(payload_data)`
2. Recover ECDSA public key from the signature. Derive sender's EVM address from the public key.
3. Check that the message comes from TSS address.
4. Route the payload to the corresponding operation code.
# ZetaChain TON Protocol Contracts

Contracts of official protocol contracts deployed by the core ZetaChain team.

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

- Contract compilation: `make compile`
- Contract tests: `make test`
- Contract scripts: `make run`

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

- `set_deposits_enabled` - toggle deposits
- `update_tss` - update TSS public key
- `update_code` - upgrade the contract code
- `update_authority` - update authority TON address

### Withdrawals

ZetaChain uses MPC to sign all outbound transactions using TSS (Threshold Signature Scheme).
Due to the technical implementation TSS uses ECDSA cryptography in opposite to EdDSA in TON. Thus, we need to
check ECDSA signatures in the contract on-chain.

All TSS commands are represented as external messages that have the following structure:

- `uint32 op_code` - operation code. Standard for TON
- `[65]byte signature` - ECDSA signature of the message hash (v, r, s)
- `[32]byte hash` - hash of the payload
- `ref cell payload` - the actual payload

By having this structure we can sign arbitrary messages using ECDSA, recover signature,
then ensure sender and proceed with the operation.

The payload for `op withdrawal (200)` is the following:

```
recipient:MsgAddr amount:Coins seqno:uint32
```

#### External message signature flow:

Let’s simplify the input as `["signature", "payload_hash", "payload_data"]`:

- With `sig + hash`, we can derive the signer's public key -> EVM address -> check that the message comes from TSS.
- By having `hash + payload_data`, we can check that the payload is **exactly** the same as the one that was signed.
- Otherwise, the sender could take any valid `sig + hash`, append an **arbitrary payload**, and execute the contract
  on behalf of TSS (e.g. "withdraw 1000 TON to address X").
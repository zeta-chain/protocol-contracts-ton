# Zetachain Protocol Contracts for TON

This repo contains **Gateway** implementation that brings cross-chain capabilities to The Open Network by leveraging Zetachain's Universal Apps. 

## Learn more about ZetaChain

* Check our [website](https://www.zetachain.com/)
* Read our [docs](https://docs.zetachain.com/)

## Supported user operations

| Op      | Name               | Description                                                        |
|---------|--------------------|--------------------------------------------------------------------|
| 100     | `donate`           | Donate TON to the Gateway :)                                       |
| 101     | `deposit`          | Deposit TON to a recipient on Zeta EVM                             |
| 102     | `deposit_and_call` | Deposits TON to Zeta EVM and call a contract with `call_data`      |
| 103     | `call`             | Trigger `onCall` on Zeta EVM contract with specified `call_data`   |


Withdraw operations are initiated by invoking `Gateway.withdraw(...)` in Zetachain. 
Check out our docs for further reference!

[Contracts Documentation](./docs/gateway.md) (codegen)

## Project structure

The project is built using [Blueprint](https://github.com/ton-org/blueprint).

- `contracts` - FunC contracts source code
- `types` - TS types & (de)serialization utils
- `wrappers` - TS wrappers for ease of interacting with gateway
- `tests` - tests for the contracts.
- `scripts` - Blueprint scripts with various tasks

## How to use

- `make compile` compiles all smart contracts;
- `make test` executes the unit tests for the contracts;
- `make deploy` deploys the Gateway;
- `make tx` sends various messages to the contract;

## Localnet

This project is integrated with Zeta's [localnet](https://github.com/zeta-chain/localnet). It essentially allows developers to write cross-chain apps between EVM, SOL, TON, and more with full end-to-end testing **locally**

You can send transactions directly to localnet's Gateway by calling `make tx-localnet`. Note that most TON wallets don't support custom networks, so the mnemonic is used for dev purposes *only*

```sh
export WALLET_VERSION="V5R1" # or other version
export WALLET_MNEMONIC="front local amused plastic ..."

make tx-localnet
```

Tip: to generate a wallet on localnet use the following command (in localnet's repo)

```sh
yarn localnet ton wallet
```

## How it works

All inbound operations (deposit, call, ...) are represented as internal messages that have the following structure:

- uint32 `op_code` - operation code. Standard for TON
- uint64 `query_id` - not used right now. Standard for TON
- ... the rest of the message is the operation-specific data

Use `types` package for encoding/decoding data to BoC.

Example `deposit` message schema:

```
op_code:uint32 query_id:uint64 evm_recipient:slice (160 bits / 20 bytes)
```

### Gas usage

Due to nature of TON, we use gas "ceiling" approach where we assume that each op has a const "max cost" that we subtract from the caller. you can call the `int calculate_gas_fee(int op) method_id` getter to receive a fee in nanoTON. 

Example: to send 1 TON to Zeta recipient `0x873F092B7598D1B2BEa4F21C7f3b86b9e8f6e7e4`, you actually need to send 1 TON + calculate_gas_fee(101), where 101 is the op code for the deposit operation.


### Withdrawals

> All withdrawals are triggered by Zeta EVM, developers don't need to worry about these technical nuances.

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

External message signature flow:

1. Calculate the hash of the payload cell: `payload_hash` = `sha256(payload_data)`
2. Recover ECDSA public key from the signature. Derive sender's EVM address from the public key.
3. Check that the message comes from TSS address.
4. Route the payload to the corresponding operation code.

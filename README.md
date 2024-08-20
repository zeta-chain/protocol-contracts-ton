# ZetaChain TON Protocol Contracts

Contracts of official protocol contracts deployed by the core ZetaChain team.

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

### Build

`npx blueprint build`

### Test

`npx blueprint test`

### Deploy or run another script

`npx blueprint run`

### Add a new contract

`npx blueprint create ContractName`

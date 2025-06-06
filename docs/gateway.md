# TON Gateway Docs

## gateway.fc

### Constants

- **op::internal::donate** = 100
- **op::internal::deposit** = 101
- **op::internal::deposit_and_call** = 102
- **op::external::withdraw** = 200
- **op::authority::set_deposits_enabled** = 201
- **op::authority::update_tss** = 202
- **op::authority::update_code** = 203
- **op::authority::update_authority** = 204

### `handle_deposit`

```func
() handle_deposit(int amount, slice in_msg_body) impure inline {
```

Deposit TON to the gateway and specify the EVM recipient on ZetaChain

### `handle_set_deposits_enabled`

```func
() handle_set_deposits_enabled(slice sender, slice message) impure inline {
```

Enables or disables deposits.

### `handle_update_tss`

```func
() handle_update_tss(slice sender, slice message) impure inline {
```

Updates the TSS address. WARNING! Execute with extra caution.
Wrong TSS address leads to loss of funds.

### `handle_update_code`

```func
() handle_update_code(slice sender, slice message) impure inline {
```

Updated the code of the contract
Handle_code_update (cell new_code)

### `recv_internal`

```func
() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
```

Input for all internal messages

### `handle_withdrawal`

```func
() handle_withdrawal(slice payload) impure inline {
```

Withdraws assets to the recipient

Handle_withdrawal (MsgAddr recipient, Coins amount, int seqno)

### `recv_external`

```func
() recv_external(slice message) impure {
```

Entry point for all external messages

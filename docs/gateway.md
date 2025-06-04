# TON Gateway Docs

## gateway.fc

### `guard_deposits`

**Signature:**
```func
() guard_deposits() impure inline_ref {
```

**Description:**
Checks that deposits are enabled

### `guard_authority_sender`

**Signature:**
```func
() guard_authority_sender(slice sender) impure inline_ref {
```

**Description:**
Checks that sender is the authority

### `guard_cell_size`

**Signature:**
```func
() guard_cell_size(cell data, int max_size_bits, int throw_error) impure inline {
```

**Description:**
Protects gas usage against huge payloads

### `handle_deposit`

**Signature:**
```func
() handle_deposit(int amount, slice in_msg_body) impure inline {
```

**Description:**
Deposit TON to the gateway and specify the EVM recipient on ZetaChain

### `handle_set_deposits_enabled`

**Signature:**
```func
() handle_set_deposits_enabled(slice sender, slice message) impure inline {
```

**Description:**
Enables or disables deposits.

### `handle_update_tss`

**Signature:**
```func
() handle_update_tss(slice sender, slice message) impure inline {
```

**Description:**
Updates the TSS address. WARNING! Execute with extra caution.
Wrong TSS address leads to loss of funds.

### `handle_update_code`

**Signature:**
```func
() handle_update_code(slice sender, slice message) impure inline {
```

**Description:**
Updated the code of the contract
Handle_code_update (cell new_code)

### `recv_internal`

**Signature:**
```func
() recv_internal(int my_balance, int msg_value, cell in_msg_full, slice in_msg_body) impure {
```

**Description:**
Input for all internal messages

### `handle_withdrawal`

**Signature:**
```func
() handle_withdrawal(slice payload) impure inline {
```

**Description:**
Withdraws assets to the recipient

Handle_withdrawal (MsgAddr recipient, Coins amount, int seqno)

### `recv_external`

**Signature:**
```func
() recv_external(slice message) impure {
```

**Description:**
Entry point for all external messages


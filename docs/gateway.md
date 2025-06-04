# TON Gateway Docs

## messages.fc

### `send_log_message`

```func
() send_log_message(cell body) impure inline {
```

Sends an external oubound message w/o destination a.k.a log message

### `send_simple_message`

```func
() send_simple_message(int recipient, int amount, int header_bits, int mode) impure inline_ref {
```

Sends an arbitrary internal message w/o body

Int_msg_info$0 ihr_disabled:Bool bounce:Bool bounced:Bool
Src:MsgAddressInt dest:MsgAddressInt
Value:CurrencyCollection ihr_fee:Grams fwd_fee:Grams
Created_lt:uint64 created_at:uint32 = CommonMsgInfo;

## gateway.fc

### `guard_deposits`

```func
() guard_deposits() impure inline_ref {
```

Checks that deposits are enabled

### `guard_authority_sender`

```func
() guard_authority_sender(slice sender) impure inline_ref {
```

Checks that sender is the authority

### `guard_cell_size`

```func
() guard_cell_size(cell data, int max_size_bits, int throw_error) impure inline {
```

Protects gas usage against huge payloads

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

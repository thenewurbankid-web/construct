## Refund request

The "refund request" flow has 8 steps. It starts in *submitted* and can end in *closed* or *rejected*.

### submitted _(initial)_

- This flow starts in *submitted*.
- When "request refund" happens, the flow moves to *auto check*.

### auto check _(normal)_

- On entering, it runs `logCheckStarted`.
- Immediately, the flow moves to *approved* — only if it is low value.
- Otherwise, if it is suspicious, the flow moves to *manual review*.
- Otherwise, immediately, the flow moves to *manual review*.

### manual review _(normal)_

- When "approve" happens, the flow moves to *approved* and then runs `notifyCustomer`.
- When "reject" happens, the flow moves to *rejected* and then runs `notifyCustomer`.
- When "need more info" happens, the flow moves to *submitted*.
- After 48 hours, the flow moves to *escalated*.

### escalated _(normal)_

- When "approve" happens, the flow moves to *approved*.
- When "reject" happens, the flow moves to *rejected*.

### approved _(normal)_

- While here, it starts `issueRefund`.
- When `issueRefund` finishes successfully, the flow moves to *refunded*.
- If `issueRefund` fails, the flow loops back to *approved* and then runs `alertFinance`.

### refunded _(normal)_

- When "close" happens, the flow moves to *closed*.

### closed _(final)_

- *closed* is an end state — the flow stops there.

### rejected _(final)_

- *rejected* is an end state — the flow stops there.

### Scenarios

#### Happy path
_submitted → auto check → approved → refunded → closed_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when it is low value
- Then the flow moves to *approved*
- And when `issueRefund` finishes successfully
- Then the flow moves to *refunded*
- And when "close" happens
- Then the flow moves to *closed*
- And the flow ends — *closed* is an end state
- Note: in *approved* the flow can start that step over when `issueRefund` fails, so this part can repeat.

#### Path 2
_submitted → auto check → manual review → approved → refunded → closed_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when it is suspicious (the earlier conditions did not apply)
- Then the flow moves to *manual review*
- And when "approve" happens
- Then the flow moves to *approved* and then runs `notifyCustomer`
- And when `issueRefund` finishes successfully
- Then the flow moves to *refunded*
- And when "close" happens
- Then the flow moves to *closed*
- And the flow ends — *closed* is an end state
- Note: in *approved* the flow can start that step over when `issueRefund` fails, so this part can repeat.
- Note: from *manual review* the flow can go back to *submitted* when "need more info" happens, so this part can repeat.

#### Path 3
_submitted → auto check → manual review → rejected_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when it is suspicious (the earlier conditions did not apply)
- Then the flow moves to *manual review*
- And when "reject" happens
- Then the flow moves to *rejected* and then runs `notifyCustomer`
- And the flow ends — *rejected* is an end state
- Note: from *manual review* the flow can go back to *submitted* when "need more info" happens, so this part can repeat.

#### Path 4
_submitted → auto check → manual review → escalated → approved → refunded → closed_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when it is suspicious (the earlier conditions did not apply)
- Then the flow moves to *manual review*
- And when 48 hours pass
- Then the flow moves to *escalated*
- And when "approve" happens
- Then the flow moves to *approved*
- And when `issueRefund` finishes successfully
- Then the flow moves to *refunded*
- And when "close" happens
- Then the flow moves to *closed*
- And the flow ends — *closed* is an end state
- Note: in *approved* the flow can start that step over when `issueRefund` fails, so this part can repeat.
- Note: from *manual review* the flow can go back to *submitted* when "need more info" happens, so this part can repeat.

#### Path 5
_submitted → auto check → manual review → escalated → rejected_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when it is suspicious (the earlier conditions did not apply)
- Then the flow moves to *manual review*
- And when 48 hours pass
- Then the flow moves to *escalated*
- And when "reject" happens
- Then the flow moves to *rejected*
- And the flow ends — *rejected* is an end state
- Note: from *manual review* the flow can go back to *submitted* when "need more info" happens, so this part can repeat.

#### Path 6
_submitted → auto check → manual review → approved → refunded → closed_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when none of the conditions above apply
- Then the flow moves to *manual review*
- And when "approve" happens
- Then the flow moves to *approved* and then runs `notifyCustomer`
- And when `issueRefund` finishes successfully
- Then the flow moves to *refunded*
- And when "close" happens
- Then the flow moves to *closed*
- And the flow ends — *closed* is an end state
- Note: in *approved* the flow can start that step over when `issueRefund` fails, so this part can repeat.
- Note: from *manual review* the flow can go back to *submitted* when "need more info" happens, so this part can repeat.

#### Path 7
_submitted → auto check → manual review → rejected_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when none of the conditions above apply
- Then the flow moves to *manual review*
- And when "reject" happens
- Then the flow moves to *rejected* and then runs `notifyCustomer`
- And the flow ends — *rejected* is an end state
- Note: from *manual review* the flow can go back to *submitted* when "need more info" happens, so this part can repeat.

#### Path 8
_submitted → auto check → manual review → escalated → approved → refunded → closed_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when none of the conditions above apply
- Then the flow moves to *manual review*
- And when 48 hours pass
- Then the flow moves to *escalated*
- And when "approve" happens
- Then the flow moves to *approved*
- And when `issueRefund` finishes successfully
- Then the flow moves to *refunded*
- And when "close" happens
- Then the flow moves to *closed*
- And the flow ends — *closed* is an end state
- Note: in *approved* the flow can start that step over when `issueRefund` fails, so this part can repeat.
- Note: from *manual review* the flow can go back to *submitted* when "need more info" happens, so this part can repeat.

#### Path 9
_submitted → auto check → manual review → escalated → rejected_
- Given the flow starts in *submitted*
- When "request refund" happens
- Then the flow moves to *auto check*
- And when none of the conditions above apply
- Then the flow moves to *manual review*
- And when 48 hours pass
- Then the flow moves to *escalated*
- And when "reject" happens
- Then the flow moves to *rejected*
- And the flow ends — *rejected* is an end state
- Note: from *manual review* the flow can go back to *submitted* when "need more info" happens, so this part can repeat.

### Health

No problems found: every step is reachable and every non-final step has a way out.

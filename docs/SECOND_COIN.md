# Second Coin Runtime

The deployed UI lets the creator initialize one JOFP coin at runtime without editing source code.

Parameters selected at initialization:
- Name
- Symbol
- Decimals (0–8)
- Genesis supply

The genesis supply is assigned to the JOFP node that initializes the coin.
Transfers are signed by the sender node's ECDSA identity and replay-protected.

The runtime stores integer smallest units in D1.
Example: 4 decimals and 1.25 coins = 12500 smallest units.

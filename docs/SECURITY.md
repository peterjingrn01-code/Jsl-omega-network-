# JOFP Security Model

Implemented:
- ECDSA P-256 / SHA-256 signatures
- ECDH P-256 shared-key derivation
- AES-GCM-256 end-to-end payload encryption
- non-exportable private CryptoKeys stored in IndexedDB
- server-side signature verification before message acceptance
- receiver-side signature verification before decryption
- unique replay nonce enforcement
- message timestamp and expiry validation
- delivery target checking
- payload size limit
- simple per-node server rate limiting
- CSP and security response headers for static assets

Operational limits:
- OMEGA_NETWORK_KEY is still a shared test/deployment gate.
- Browser identity recovery/rotation is not automated.
- D1 coin transfers are suitable for controlled validation; high-value financial deployment would require additional economic, legal, concurrency and incident-response design.

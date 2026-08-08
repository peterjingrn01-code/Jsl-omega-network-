# JOFP 1.1 Security

Implemented: ECDSA P-256 signatures, ECDH P-256 key agreement, AES-GCM-256 E2E encryption, device-local IndexedDB private keys, signed message envelopes, replay nonce rejection, message expiry, payload limits, rate limiting, secure-node-only discovery, delivery acknowledgement, CSP/security headers.

Legacy nodes without signing/ECDH public identity are hidden from normal discovery and must re-register once after upgrading.

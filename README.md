# JOFP 1.0 — Complete Deployable Platform

JOFP is the JSL Omega Field Protocol for Block Space Network connections.

This package contains the full deployable platform:
- Pure JSL JOFP protocol definition
- Cloudflare Worker API
- D1 field persistence
- Secure device identity
- ECDSA P-256 signatures
- ECDH P-256 key agreement
- AES-GCM-256 end-to-end encrypted messages
- message expiry + replay protection
- delivery acknowledgement
- rate limiting
- static web client
- reusable JOFP browser SDK
- Second Coin runtime using signed JOFP node transactions

## Important deployment note

Your existing D1 database already contains Alpha/Beta data.
Run `worker/upgrade-existing.sql` once before deploying this release.

Replace only the placeholder D1 UUID in `wrangler.toml` with the UUID already used by your current project. This is configuration, not source-code modification.

Your existing `OMEGA_NETWORK_KEY` Cloudflare secret remains in Cloudflare and is not stored in this repository.

## Deploy

1. Run `worker/upgrade-existing.sql` in the existing D1 Console.
2. Put the existing D1 UUID into `wrangler.toml`.
3. Replace the GitHub repository contents with this package and commit.
4. Cloudflare Git deployment deploys it automatically.
5. Open JOFP on each test device and press REGISTER / IDENTITY once.
6. Test secure messaging.
7. In Second Coin Runtime, choose the coin name/symbol/supply and initialize it once.
8. Transfer coin between registered JOFP nodes.

## Validation status

The JavaScript files and repository structure were checked before packaging.
This release is intended for controlled real-network validation and iterative improvement.
Do not treat an experimental coin balance as legal tender or promise financial returns.

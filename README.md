# JOFP Commercial Block Space Platform 1.1

Complete deployable JOFP platform package for the existing Cloudflare project.

## Main fix from 1.0
The prior test exposed legacy Alpha nodes without secure public identity. JOFP 1.1 now filters discovery to secure nodes only. A device upgrades by opening the platform and pressing REGISTER / IDENTITY once. This prevents normal users from selecting an incompatible legacy target and getting `target_identity_missing`.

## Included
- Cloudflare Worker + D1 + Assets
- Secure device identity (ECDSA P-256 + ECDH P-256)
- AES-GCM-256 end-to-end encrypted messaging
- Signed envelopes and replay protection
- Secure-node discovery and pairing
- Delivery acknowledgement
- Field status dashboard
- Reusable browser SDK
- Optional Second Coin runtime
- Existing D1 database ID already configured

## Deploy
Replace the entire contents of the existing `jsl-omega-network` GitHub repository with this package and commit. Cloudflare Git deployment should deploy automatically. The D1 upgrade tables from the previous package are already present, so no additional SQL is required for this 1.1 package.

After deployment, open the new site on every active device and press REGISTER / IDENTITY once. Then DISCOVER SECURE NODES -> PAIR -> ENCRYPT + SIGN + SEND -> RECEIVE + VERIFY + DECRYPT.

## Commercial operation
This package is an operational production candidate, not a promise of zero vulnerabilities. For public commercial service, also configure support, terms/privacy, backups, monitoring/alerts, incident response, billing, and any jurisdiction-specific compliance that applies to your business.

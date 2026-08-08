# JOFP 1.1 Full Deployment

1. Replace the existing GitHub repository contents with this entire package.
2. Do not run more D1 migrations for 1.1; the required replay/rate/coin tables were already created during the prior upgrade.
3. Preserve the existing Cloudflare `OMEGA_NETWORK_KEY` secret.
4. Confirm Cloudflare build is green.
5. Open the deployed site on every active device and press REGISTER / IDENTITY once.
6. DISCOVER now shows only nodes with JOFP secure identity.
7. Test Pair, encrypted Send, Receive/Verify/Decrypt.
8. Then initialize/test the optional Second Coin runtime if wanted.

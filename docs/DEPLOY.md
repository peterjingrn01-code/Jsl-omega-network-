# Deployment Checklist

Existing infrastructure:
- Cloudflare project: jsl-omega-network
- D1 binding: DB
- D1 database: jsl_omega_network
- Assets binding: ASSETS
- Suggested hostname: jofp.jsl-ian.com

Upgrade:
1. Execute `worker/upgrade-existing.sql` once in D1 Console.
2. Preserve the current D1 UUID in wrangler.toml.
3. Commit the complete repository.
4. Confirm Cloudflare build says Worker + Assets + DB.
5. `/health` must return protocol JOFP/1.0.
6. Re-register each device once to create secure local identity.
7. Discover, send encrypted message, receive verified plaintext.
8. Initialize the second coin once.
9. Transfer from creator node to another node.

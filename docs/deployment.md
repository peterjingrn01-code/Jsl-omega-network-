# GitHub + Cloudflare deployment

## GitHub repository

Create `jsl-omega-network` and upload this folder as the repository root.

## Worker

1. Put the D1 database UUID into `wrangler.toml`.
2. Install:

   `npm install`

3. Initialize the remote D1 schema:

   `npm run db:init`

4. Set the shared test key:

   `npx wrangler secret put OMEGA_NETWORK_KEY`

5. Deploy:

   `npm run deploy:worker`

## Pages

Connect the same repository to Cloudflare Pages:

- Root directory: `web`
- Build command: blank
- Build output directory: `.`
- Custom domain: `jofp.jsl-ian.com`

## Three-device test

Open the Pages URL on a phone, desktop, and notebook. Enter the same Worker URL and Network Key, use unique device names, then test Register, Discover, Pair, Send, and Receive.

# Pine Launcher Anonymous Online Counter (Cloudflare Worker)

A zero-cost (\$0/month on Cloudflare's free tier) anonymous live-player counter using a SQLite-backed Durable Object.

- **Stores zero personal data**: only an ephemeral random per-launch `sessionId`, `state` (`launcher` or `playing`), app `version`, and OS `platform`. Never stores IP addresses, usernames, UUIDs, or server addresses.
- **Private stats**: `/stats` and `/dashboard` require your private `ADMIN_TOKEN` secret stored only in Cloudflare.

## Deploy in 3 commands

```bash
cd workers/online-counter
npx wrangler login
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Copy the deployed `https://pine-launcher-online-counter.<your-subdomain>.workers.dev` URL into `DEFAULT_ONLINE_COUNTER_ENDPOINT` in `lib/online-counter.js` (or set `PINE_ONLINE_COUNTER_URL` when testing).

## Check live players (private to you)

Open `https://<your-worker>.workers.dev/dashboard` in your browser and enter your `ADMIN_TOKEN`, or run:

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" https://<your-worker>.workers.dev/stats
```

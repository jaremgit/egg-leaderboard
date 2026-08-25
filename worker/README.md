# Submission Worker Setup Guide

This folder contains a small **Cloudflare Worker** - a tiny bit of server-side
code - that lets visitors on the site enter their EggInc ID (EID), privately
look up their own ALL_TIME / Grade AAA (grade 5) rank, and have it published
to the leaderboard automatically. This is separate from the main static site
(`index.html` / `styles.css` / `app.js`), which cannot run server code on its
own.

**Privacy guarantee:** the EID a visitor types in is only ever held in memory
for the single request that looks it up. It is never written to a log,
database, or git commit. Only the resulting public leaderboard info (name,
score, rank - the same thing already visible on the leaderboard) gets saved.

You only need to do this setup **once**. After that, it keeps working
automatically.

## What you'll need (all free)

1. A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is enough).
2. A GitHub Personal Access Token so the Worker can commit to this repo.
3. Node.js installed on your computer (you already have this for the repo's
   existing GitHub Action, but you can also just run these commands from
   any machine with Node 18+).

## Step 1 - Install the tools

Open a terminal in the `worker/` folder and run:

```
npm install
```

## Step 2 - Log in to Cloudflare

```
npx wrangler login
```

This opens a browser window - log in or sign up, then approve access.

## Step 3 - Create the rate-limit storage (KV namespace)

```
npx wrangler kv namespace create RATE_LIMIT_KV
```

This prints something like:

```
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "abcd1234..."
```

Copy that `id` value and paste it into `worker/wrangler.toml`, replacing
`REPLACE_WITH_KV_NAMESPACE_ID`.

## Step 4 - Create a GitHub token

1. Go to GitHub -> Settings -> Developer settings -> [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens/new).
2. Name it something like `egg-leaderboard-submit-worker`.
3. Repository access: **Only select repositories** -> choose `egg-leaderboard`.
4. Permissions: **Contents -> Read and write** (nothing else is needed).
5. Generate the token and copy it (you won't be able to see it again).

## Step 5 - Add your secrets to the Worker

Secrets are never written into any file in this repo - they're stored
securely by Cloudflare.

```
npx wrangler secret put GITHUB_TOKEN
```
Paste the GitHub token from Step 4 when prompted.

```
npx wrangler secret put SUBMIT_HASH_SALT
```
Paste any random long string here (e.g. generate one at
https://1password.com/password-generator or just mash your keyboard for 30+
characters). This is only used to scramble EIDs before they touch the
rate-limit storage - you'll never need to remember it.

## Step 6 - Deploy

```
npm run deploy
```

Wrangler will print a URL like:

```
https://egg-leaderboard-submit.<your-subdomain>.workers.dev
```

Copy that URL - you'll paste it into `app.js` as `SUBMIT_WORKER_URL` (see the
"Submit your score" section near the top of `app.js`).

## Updating later

If you ever change the logic in `worker/index.js`, just run `npm run deploy`
again from the `worker/` folder - no need to redo the account/secret setup.

## Troubleshooting

- **"Couldn't save your submission"** - usually means the GitHub token
  doesn't have write access, or it expired. Re-check Step 4/5.
- **"That EggInc ID couldn't be looked up"** - the ID was valid-looking but
  `ei_worker` couldn't find a matching ALL_TIME/AAA entry for it.
- **"You've already submitted today"** - the one-per-day rate limit is
  working as intended; ask the visitor to try again tomorrow.

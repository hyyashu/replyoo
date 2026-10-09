# Deploying Replyooo on a VPS (Docker Compose)

One server runs everything: Postgres, Redis, the web app, the worker and Caddy, which terminates HTTPS and
routes `/webhooks/meta` to the worker and everything else to the web app. A 2 vCPU / 4 GB server is plenty for
a first live test.

```
Internet ── Caddy :80/:443 ──┬─ /webhooks/meta ─▶ worker :3001 ─▶ Redis, Postgres
                             └─ everything else ─▶ web    :3000 ─▶ Postgres
```

Files: `Dockerfile`, `docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/.env.example`.

Using Dokploy instead? Its Traefik already owns ports 80/443, so skip Caddy and follow
[Deploying with Dokploy](#deploying-with-dokploy) below. Everything else here (env values, Meta setup, first test) still applies.

## 1. Server and DNS

1. Create an Ubuntu 24.04 (or similar) VPS and note its public IP.
2. Add a DNS **A record** for your hostname (for example `app.example.com`) pointing at that IP. Wait until
   `dig +short app.example.com` returns it. Caddy can't get a certificate before this resolves.
3. Open only SSH, HTTP and HTTPS:
   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
   ```
   Postgres and Redis publish no ports, so they are reachable only from inside the Compose network.
4. Install Docker Engine with the Compose plugin: <https://docs.docker.com/engine/install/ubuntu/>.

## 2. Get the code and configure

```bash
git clone <your-repo-url> replyooo && cd replyooo
cp deploy/.env.example .env
```

Edit `.env`. Generate the secrets on the server:

```bash
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -hex 32      # BETTER_AUTH_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY (must be exactly 32 bytes, base64)
openssl rand -hex 16      # META_WEBHOOK_VERIFY_TOKEN
```

- Set `DOMAIN` to the hostname from step 1 (no `https://`).
- Keep `COMPOSE_PROFILES=caddy`: it is what starts the Caddy container. Without it nothing serves HTTPS.
- Set a real `EMAIL_PROVIDER` (`resend` or `smtp`), `EMAIL_FROM`, and the matching credentials (`RESEND_API_KEY`
  or `SMTP_HOST` and friends). The worker refuses to start with `EMAIL_PROVIDER=log` in production, because it
  only prints emails and never delivers them.
- **Back up `.env`**, especially `TOKEN_ENCRYPTION_KEY`. Without it, stored Meta tokens can't be decrypted and every
  account has to reconnect.

## 3. Start it

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

The first build takes several minutes. Startup order is handled for you: Postgres and Redis become healthy, the
`migrate` job applies the SQL migrations and exits, then `web` and `worker` start, then Caddy fetches the
certificate. Check:

```bash
curl -I https://app.example.com/login                       # 200
curl "https://app.example.com/webhooks/meta?hub.mode=subscribe&hub.verify_token=<your token>&hub.challenge=ok"   # prints: ok
docker compose -f docker-compose.prod.yml logs -f worker web
```

The worker's `/health` route is deliberately not exposed publicly; Docker checks it internally.

## 4. Configure the Meta app

In the Meta developer dashboard for your app:

1. **Webhooks:** callback URL `https://app.example.com/webhooks/meta`, verify token = `META_WEBHOOK_VERIFY_TOKEN`.
   (On Dokploy the webhook has its own host: `https://replyoo-hooks.sitebackend.com/webhooks/meta`.)
   Subscribe the Instagram comment and message fields (and the Page feed and message fields if you use Facebook).
2. **OAuth redirect URIs:** add both of these (Instagram and Facebook Login use one each):
   - `https://app.example.com/api/meta/oauth/instagram/callback`
   - `https://app.example.com/api/meta/oauth/facebook/callback`
3. **Deauthorize and data-deletion callback URLs:**
   - Deauthorize: `https://app.example.com/api/meta/deauthorize`
   - Data deletion: `https://app.example.com/api/meta/data-deletion`
4. Keep the app in **Development mode** for the first test. Only accounts with a role on the app (admin, developer,
   tester) can use it, and no App Review is needed. Live mode for real customers needs App Review and Business
   Verification.
5. The Instagram account must be a Professional (Business or Creator) account.

## 5. First live test

1. Sign up on your domain and confirm the email arrives.
2. Connect your own Instagram account.
3. Publish a simple comment → DM → link automation.
4. Comment from a second account on one of your posts (pick it in the "Which posts" picker, or use "Any post").
5. Watch `docker compose -f docker-compose.prod.yml logs -f worker` and check the message arrives.
6. Then try features one at a time: follow gate, email question, then the reminder (set a short delay first).

## Operating it

| Task | Command |
| --- | --- |
| Update | `git pull && docker compose -f docker-compose.prod.yml up -d --build` (migrations run automatically) |
| Logs | `docker compose -f docker-compose.prod.yml logs -f --tail 100 web worker` |
| Restart one service | `docker compose -f docker-compose.prod.yml restart worker` |
| Stop (keeps data) | `docker compose -f docker-compose.prod.yml down` |

**Never** add `-v` to `down` on a live server: it deletes the database volume.

### Background jobs

The worker runs these on a schedule (UTC), with no setup:

| Job | When | What it does |
| --- | --- | --- |
| `sweep` | every minute | Re-queues timed-out waits, lost run starts, stuck messages and unprocessed webhook events |
| `refresh-tokens` | daily 03:00 | Renews Instagram tokens that expire within 10 days; flags the account for reconnect if Meta refuses |
| `refresh-profiles` | every 6 hours (:15) | Re-reads each active account's name, picture and follower count, because Instagram and Facebook picture links expire |
| `prune-webhooks` | daily 03:30 | Deletes stored webhook events older than 30 days |

### Backups

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U replyooo replyooo | gzip > replyooo-$(date +%F).sql.gz
```

Run it daily from cron and copy the files off the server. Test a restore once with
`gunzip -c file.sql.gz | docker compose ... exec -T postgres psql -U replyooo replyooo` on a scratch database. Redis
holds only queued jobs and rate-limit counters, so it isn't part of the backup.

### Troubleshooting

- **Compose says a variable is missing:** the message names it; add it to `.env`.
- **No certificate / browser warning:** DNS isn't pointing at the server yet, or ports 80/443 are blocked. See
  `docker compose ... logs caddy`.
- **Meta can't verify the webhook:** the verify token in the dashboard must match `.env` exactly. Run the `curl`
  check above first.
- **`migrate` fails:** `docker compose ... logs migrate`. The web app and worker won't start until it succeeds.
- **The opener goes out but the follow-up DM never arrives:** search the worker log for `outbound message failed`. It
  carries Meta's own `metaMessage`, `code` and `subcode`; the message row in the database only keeps a short reason such
  as `invalid_request`. Code 100 / subcode 2534037 (“not the thread owner”) means another app or the Instagram inbox
  controls that conversation (Meta's Conversation Routing). Private replies to comments still work, because they aren't
  tied to a thread. Disconnect other messaging tools from the Instagram account, avoid replying by hand in the
  Instagram app or Business Suite to test chats, and retry with an account that has no earlier thread.

## Deploying with Dokploy

Dokploy runs its own Traefik on ports 80/443, which does the HTTPS certificates and routing that Caddy does above.
The Caddy container would fail to bind those ports, so it stays off: it is only started by `COMPOSE_PROFILES=caddy`,
which you leave out.

1. **DNS:** point A records for two hostnames at the Dokploy server: the app (`replyoo.sitebackend.com`) and a
   separate webhook host (`replyoo-hooks.sitebackend.com`) that only Meta calls.
2. **Create the app:** Project → Create Service → **Compose**. Source: this Git repository, branch `main`.
   Compose type **Docker Compose**, compose path `./docker-compose.prod.yml`.
3. **Environment tab:** paste the contents of `deploy/.env.example`, fill it in (see step 2 above for generating the
   secrets), and **delete the `COMPOSE_PROFILES=caddy` line**. Dokploy saves this as the `.env` the compose file reads.
4. **Advanced tab:** turn on **Isolated Deployment**, so Dokploy connects the services to Traefik's network itself.
5. **Domains tab:** add two entries, both with HTTPS on and certificate type Let's Encrypt:

   | Host | Path | Service | Port |
   | --- | --- | --- | --- |
   | `replyoo-hooks.sitebackend.com` | `/webhooks/meta` | `worker` | 3001 |
   | `replyoo.sitebackend.com` | `/` | `web` | 3000 |

   Because the webhook has its own host, the path rule can't be shadowed by the web entry.

   "Preview Compose" shows the generated Traefik labels if you want to check them.
6. **Deploy.** The first build takes several minutes. `migrate` runs first and exits; `web` and `worker` wait for it.
7. **Check** from your own machine, as in step 3 above:
   `curl "https://replyoo-hooks.sitebackend.com/webhooks/meta?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=ok"`
   must print `ok`, and `https://replyoo.sitebackend.com/login` must load. If the webhook URL returns a 404 page
   instead, the `/webhooks/meta` domain entry has the wrong host, path or service: re-check it.

Then continue with "Configure the Meta app" and "First live test". Updates are a redeploy from Dokploy. Postgres data
lives in the named volume `pgdata`; back it up with `pg_dump` as above (run it through `docker exec` on the
postgres container) or Dokploy's volume backups. Never delete the compose service's volumes from the UI.

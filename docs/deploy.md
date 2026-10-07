# Deploying Replyooo on a VPS (Docker Compose)

One server runs everything: Postgres, Redis, the web app, the worker and Caddy, which terminates HTTPS and
routes `/webhooks/meta` to the worker and everything else to the web app. A 2 vCPU / 4 GB server is plenty for
a first live test.

```
Internet ── Caddy :80/:443 ──┬─ /webhooks/meta ─▶ worker :3001 ─▶ Redis, Postgres
                             └─ everything else ─▶ web    :3000 ─▶ Postgres
```

Files: `Dockerfile`, `docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/.env.example`.

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
4. Comment from a second account on one of your posts. Use "Any post" or "My next post": the "Which posts" picker in
   the builder still shows sample posts.
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

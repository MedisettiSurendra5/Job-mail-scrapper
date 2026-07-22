# Deploying to your Synology NAS

This app ships as a single Docker image (Express API + the built React app +
a headless Chromium for the JobRight automation), backed by a SQLite file
that lives on a persistent volume. Synology's **Container Manager** app runs
`docker-compose.yml` directly, so there's no need to hand-build the image on
the NAS itself if you'd rather build it on your Mac and push it - but the
simplest path is building right on the NAS.

## 1. Get the project onto the NAS

Copy the whole project folder (everything in this repo) onto the NAS, e.g.
via File Station, `scp`, or a Git checkout if the NAS has git. A shared
folder like `/volume1/docker/jobright-outreach/` works well.

## 2. Fill in `.env`

Copy `.env.example` to `.env` in the project root and fill in real values:

- `JOBRIGHT_EMAIL` / `JOBRIGHT_PASSWORD` - the one shared JobRight login.
- `JWT_SECRET` / `ENCRYPTION_KEY` - generate with `openssl rand -hex 32` (run
  this on any machine, doesn't have to be the NAS).
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` - creates your first admin
  login on first boot only. Change your password after logging in once,
  then feel free to delete these two lines.
- Leave `DATA_DIR` / `DATABASE_URL` alone - `docker-compose.yml` overrides
  them to the right in-container paths automatically.

**Do not commit `.env`.** It holds real credentials.

## 3. Start it with Container Manager

Either:

- **Container Manager UI**: Project → Create → point it at the folder
  containing `docker-compose.yml` → Build.
- **SSH**, if you've enabled it (Control Panel → Terminal & SNMP):
  ```
  cd /volume1/docker/jobright-outreach
  sudo docker compose up -d --build
  ```

First boot will take a few minutes (installing the Playwright/Chromium
runtime image, `npm run build`, then running the DB migration). Once it's
up, the app listens on port 4000 - visit `http://<nas-ip>:4000`.

If you want a nicer URL/HTTPS, put Synology's built-in reverse proxy
(Control Panel → Login Portal → Advanced → Reverse Proxy) in front of
`localhost:4000`.

## 4. First login

Log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from your `.env`.
From the **Admin** page:

1. Confirm the shared JobRight login is configured (it's seeded from `.env`
   automatically; the existing logged-in session in `jobright_state.json`,
   if present in the project folder, is reused too, so you likely won't need
   to log in to JobRight again).
2. Leave **Dry run** switched on and do one end-to-end test (paste a job
   URL → Add Job → confirm contacts get pulled → Send Resume) before
   turning dry run off for real sends.
3. Create accounts for your team from **Add a team member**.

Each team member should then visit **Profile** and set their own Gmail
address + app password (from
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
requires 2-Step Verification) and upload their own resume.

## 5. Connecting your domain (already on Cloudflare)

The simplest and most secure way to expose this to your domain is a
**Cloudflare Tunnel** - it doesn't require forwarding any ports on your
router, doesn't expose your NAS's IP address, and Cloudflare handles HTTPS
for you automatically. `docker-compose.yml` already has a `cloudflared`
service ready to go; you just need to create the tunnel and give it a token.

1. Go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Networks
   → Tunnels → Create a tunnel**. Choose **Cloudflared**, name it (e.g.
   `jobvana-nas`), and continue.
2. On the "Install and run a connector" step, pick **Docker**. Cloudflare
   shows a command containing a long token after `--token`, e.g.
   `cloudflared tunnel run --token eyJhbG...`. Copy just that token value.
3. Paste it into `.env` on the NAS as `CLOUDFLARE_TUNNEL_TOKEN=eyJhbG...`
   (no quotes needed).
4. Back in the Cloudflare dashboard, go to the tunnel's **Public Hostname**
   tab and add one:
   - **Subdomain**: whatever you want, e.g. `jobs`
   - **Domain**: pick your domain from the dropdown
   - **Service Type**: `HTTP`, **URL**: `app:4000` (the two containers share
     an internal Docker network, so `app` resolves to the other container by
     its compose service name - no need for the NAS's actual IP or port
     4000 to be reachable from outside at all)
   - Save. Cloudflare creates the DNS record for you automatically.
5. Start (or restart) everything so the new `cloudflared` service picks up
   the token:
   ```
   sudo docker compose up -d --build
   ```
6. Visit `https://jobs.yourdomain.com` (whatever subdomain you chose). It
   should load the login page over HTTPS within a minute or so of the tunnel
   coming up - check tunnel status on the Cloudflare dashboard (should show
   "Healthy") if it doesn't.

Leave Cloudflare's SSL/TLS mode at its default (**Full**) - the tunnel
itself is already an encrypted connection to Cloudflare's edge, so there's
no origin certificate to install on the NAS.

**Don't want a tunnel?** The alternative is forwarding port 443 on your
router to the NAS, setting up Synology's built-in reverse proxy (Control
Panel → Login Portal → Advanced → Reverse Proxy) pointing at
`localhost:4000`, generating a certificate for the domain there, and adding
a DNS A record in Cloudflare pointing at your home IP. This works but
exposes your NAS's IP to the internet and breaks if your ISP changes it - the
tunnel avoids both problems, which is why it's the recommended path above.

## Updating after a code change

```
cd /volume1/docker/jobright-outreach
git pull   # or re-copy the updated files
sudo docker compose up -d --build
```

The SQLite DB, resumes, and JobRight session all live in the `app-data`
named volume, so they survive rebuilds. To fully reset, `docker compose down
-v` (this deletes all data - users, jobs, contacts, everything).

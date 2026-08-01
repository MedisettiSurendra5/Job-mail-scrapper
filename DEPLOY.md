# Deploying to your Synology NAS

This app ships as a single Docker image (Express API + the built React app +
a headless Chromium for the JobRight automation), backed by a SQLite file
that lives on a persistent volume. Synology's **Container Manager** app runs
`docker-compose.yml` directly, so there's no need to hand-build the image on
the NAS itself if you'd rather build it on your Mac and push it - but the
simplest path is building right on the NAS.

## 1. Get the project onto the NAS

Clone this repo onto the NAS (a plain copy via File Station or `scp` works
too, but then every update is a manual re-copy). The current deployment lives
at `/volume1/web_packages/Job-mail-scrapper`, so the paths in the rest of this
document assume that location - substitute your own if it differs.

Keep the checkout separate from the app's data directory (§2b); they used to
overlap, which broke updates.

## 2. Fill in `.env`

Copy `.env.example` to `.env` in the project root and fill in real values.
Every variable the app reads is documented there; the ones you must set:

- `JWT_SECRET` / `ENCRYPTION_KEY` - generate with `openssl rand -hex 32` (run
  this on any machine, doesn't have to be the NAS).
- `JOBRIGHT_EMAIL` / `JOBRIGHT_PASSWORD` - the one shared JobRight login.
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` - creates your first admin
  login on first boot only. Change your password after logging in once,
  then feel free to delete these two lines.
- `CLOUDFLARE_TUNNEL_TOKEN` - see §5.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - optional, see §6.
- Leave `DATA_DIR` / `DATABASE_URL` alone - `docker-compose.yml` overrides
  them to the right in-container paths automatically.

`.env` is injected into the container by `docker-compose.yml`'s `env_file`, so
anything missing from it is silently missing in production too.

**Do not commit `.env`.** It holds real credentials.

## 2b. Where the data lives

`docker-compose.yml` bind-mounts **`/volume1/docker/jobvana-data`** to
`/app/data` in the container. That directory holds the SQLite DB
(`app.db`), uploaded resumes, the JobRight session (`jobright_state.json`),
and the automation's debug screenshots (`debug/`). Create it before the first
start:

```
sudo mkdir -p /volume1/docker/jobvana-data
```

It is deliberately **outside the git checkout**. It used to be the checkout's
own `data/` directory, and because the running app writes to the DB
continuously, the working tree was permanently dirty and `git pull` aborted
with *"Your local changes would be overwritten by merge: data/app.db"* - so
code changes silently stopped reaching production.

### Migrating an existing deployment

One-time move, with the app stopped so nothing is mid-write:

```
cd /volume1/web_packages/Job-mail-scrapper
sudo docker compose down
sudo mkdir -p /volume1/docker/jobvana-data
sudo cp -a data/. /volume1/docker/jobvana-data/
sudo cp -a jobright_state.json /volume1/docker/jobvana-data/   # if present
```

Keep the old `data/` directory around until you've confirmed the new
deployment works, then delete it.

## 3. Start it with Container Manager

Either:

- **Container Manager UI**: Project → Create → point it at the folder
  containing `docker-compose.yml` → Build.
- **SSH**, if you've enabled it (Control Panel → Terminal & SNMP):
  ```
  cd /volume1/web_packages/Job-mail-scrapper
  GIT_SHA=$(git rev-parse --short HEAD) sudo -E docker compose up -d --build
  ```

First boot will take a few minutes (installing the Playwright/Chromium
runtime image, `npm run build`, then running the DB migration). Once it's
up, the app listens on port 4000 - visit `http://<nas-ip>:4000`.

For a public URL over HTTPS, use the Cloudflare Tunnel in §5 - that is how
jobvana.in is served today.

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
   - **Service Type**: `HTTP`, **URL**: `http://localhost:4001` - that is the
     Synology system nginx vhost, which proxies on to the app on port 4000
     (see §5b). Both containers run with `network_mode: host`, so there is no
     user-defined Docker network and no DNS entry for `app`; the tunnel
     reaches nginx over the host's own loopback. Neither port needs to be
     reachable from outside the NAS.
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
`localhost:4001`, generating a certificate for the domain there, and adding
a DNS A record in Cloudflare pointing at your home IP. This works but
exposes your NAS's IP to the internet and breaks if your ISP changes it - the
tunnel avoids both problems, which is why it's the recommended path above.
Note this is *not* how jobvana.in is served today: there is no Synology
Reverse Proxy entry configured at all (its `ReverseProxy.json` is empty), and
the nginx vhost in §5b is hand-managed rather than generated by that UI.

## 5b. How traffic reaches the app in production

Three hops, all on the NAS:

```
Cloudflare Tunnel  (container jobvana-cloudflared-1)
    ingress: jobvana.in -> http://localhost:4001
        |
        v
Synology system nginx  (/etc/nginx/sites-enabled/jobvana.conf, listen 4001)
        |
        v
Express app  (container jobvana-app-1, 127.0.0.1:4000)
    serves BOTH /api/* and the built React SPA
```

Both containers use `network_mode: host`, so every hop is over the host's own
loopback interface and nothing but the tunnel is reachable from outside.

**nginx must not serve the SPA from disk.** The Express app already serves the
built React bundle (it is baked into the image at build time), so nginx's only
job is to pass everything through to port 4000. An earlier version of this
vhost had a `root /volume1/web_packages/Job-mail-scrapper/client/dist;` and
only proxied `location /api/`, which meant every non-API request was answered
from a stale on-disk build. Backend deploys landed, the frontend silently did
not, and the UI stayed frozen for days. That directory has been renamed to
`client/dist.stale-20260801` so nothing can fall back to it.

### Installing / updating the vhost

[`deploy/nginx/jobvana.conf`](deploy/nginx/jobvana.conf) in this repo is the
source of truth. To apply it on the NAS:

```
sudo cp /volume1/web_packages/Job-mail-scrapper/deploy/nginx/jobvana.conf \
        /etc/nginx/sites-enabled/jobvana.conf
sudo nginx -t          # must print "syntax is ok" / "test is successful"
sudo nginx -s reload
```

Edit the file in the repo and re-copy it; never edit
`/etc/nginx/sites-enabled/jobvana.conf` in place, or the next person to read
this repo will be looking at a config that isn't the one running.

### `trust proxy` and the hop count

The server sets `app.set("trust proxy", 1)` in `server/src/index.ts`, and
**1 is correct for the topology above** even though there are two proxies in
front of it. The reason is what nginx - the one hop Express talks to directly -
does with the headers:

- It *overwrites* `X-Forwarded-Proto` with a literal `https` rather than
  passing along whatever it received, so `req.protocol` is `https` regardless
  of how many hops sit further out. That is what makes the derived Google
  OAuth `redirect_uri` (§6) come out as `https://jobvana.in/...` over an
  otherwise plaintext loopback connection.
- It *appends* to `X-Forwarded-For` via `$proxy_add_x_forwarded_for`, so the
  rightmost entry is the single hop Express should strip to find the client.

If you change the number of proxies - dropping nginx, putting something in
front of the tunnel, or changing these `proxy_set_header` lines to forward
`$scheme` instead of a literal - revisit that value, or `req.ip` and
`req.protocol` will quietly start reporting the wrong thing.

## 6. Connecting Google OAuth (optional)

Members can send outreach either with a Gmail app password (§4) or by
clicking **Connect Gmail** on their Profile page, which is the OAuth flow.
The Gmail application tracker requires OAuth - an app password cannot read
mail. Until the two variables below are set, Profile shows a disabled
Connect button explaining the feature is unavailable.

1. In [console.cloud.google.com](https://console.cloud.google.com), create (or
   pick) a project and enable the **Gmail API** under *APIs & Services →
   Library*.
2. *APIs & Services → OAuth consent screen*: choose **External**, fill in the
   app name and support email, and add these scopes:
   - `https://www.googleapis.com/auth/gmail.send` - sending outreach
   - `https://www.googleapis.com/auth/gmail.readonly` - the application tracker
   - `openid` and `email` - identifies which account was connected
3. *APIs & Services → Credentials → Create credentials → OAuth client ID*,
   type **Web application**. Under **Authorized redirect URIs** add exactly:
   ```
   https://jobvana.in/api/auth/google/callback
   ```
   Google rejects non-HTTPS redirect URIs for anything but `localhost`, so a
   LAN address like `http://192.168.1.5:4000/...` can never be registered -
   connect Gmail through the public domain.
4. Put the generated client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, then `sudo docker compose up -d --build`.

   Leave `GOOGLE_REDIRECT_URI` unset: the callback URL is derived from the
   request, so it is automatically correct on every origin the app answers on.
   Only set it if the public origin differs from the one reaching the server,
   and then it must match step 3 byte for byte.
5. Verify by logging in and clicking **Connect Gmail** on the Profile page.

> ⚠️ **Publish the consent screen.** `gmail.readonly` is a *restricted* scope.
> While the project's publishing status is **Testing**, Google only issues
> tokens to explicitly-listed test users **and expires their refresh tokens
> after 7 days** - which looks exactly like "OAuth worked, then broke a week
> later". Move the consent screen to **In production** (restricted scopes
> require Google's verification review) for connections that last.
>
> If a member connected before `gmail.readonly` was added to the scope list,
> their existing token doesn't retroactively gain read access - they must
> **Disconnect** and reconnect from Profile.

## Updating after a code change

```
cd /volume1/web_packages/Job-mail-scrapper
git pull
GIT_SHA=$(git rev-parse --short HEAD) sudo -E docker compose up -d --build
```

### Verifying a deploy actually landed

Check **both** of these, not just the first one:

1. The backend is running your commit:
   ```
   curl -s https://jobvana.in/api/health     # {"ok":true,"gitSha":"<short sha>"}
   ```
   `gitSha` must equal `git rev-parse --short HEAD`. If it doesn't, the
   rebuild didn't land - check that `git pull` actually succeeded rather than
   aborting on a dirty working tree.

2. The frontend bundle actually changed:
   ```
   curl -s https://jobvana.in/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
   ```
   Vite content-hashes the bundle filename, so any deploy that touched
   `client/` must produce a different hash than the previous deploy. Record it
   before and after.

A **moving `gitSha` with a frozen bundle hash is the exact signature of the
bug in §5b**: the API is being answered by your fresh container while the HTML
and JS are coming from somewhere else - a `root` directive in the nginx vhost
pointing at an old on-disk build. If you see it, compare
`/etc/nginx/sites-enabled/jobvana.conf` against
[`deploy/nginx/jobvana.conf`](deploy/nginx/jobvana.conf) first.

(If a deploy only changed server-side code, the bundle hash legitimately stays
the same - it's the combination of *frontend changes shipped* and *hash
unchanged* that indicates the fault.)

Pending database migrations are applied automatically on container start.

The SQLite DB, resumes and JobRight session live in the
`/volume1/docker/jobvana-data` host directory (§2b), so they survive rebuilds.
`docker compose down -v` does **not** touch a bind mount - to fully reset,
stop the stack and delete that directory's contents yourself (this deletes
all data - users, jobs, contacts, everything).

## Recovering the JobRight session

Every Add Job reuses one shared, logged-in JobRight browser session. When it
is missing, the automation falls back to an interactive login against
jobright.ai, which frequently trips their bot checks and fails with a
`Sign in` click timeout.

The session is stored in the DB and mirrored to
`/volume1/docker/jobvana-data/jobright_state.json` after every successful
task. To restore a dead one, drop a known-good Playwright `storageState` JSON
at that path and restart - it is picked up on boot whenever the DB has none.
Note that re-saving the JobRight credentials from the Admin page clears the
stored session on purpose, so a re-login is attempted with the new password.

When a run does fail, the automation writes a full-page screenshot and HTML
snapshot to `/volume1/docker/jobvana-data/debug/` - check there first to see
what jobright.ai actually served the headless browser.

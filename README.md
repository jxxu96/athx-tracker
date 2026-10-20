# athx

Shared training and nutrition journal for ATHX New York 2027.

The app lives in [`athx-tracker/`](athx-tracker/). Its
[README](athx-tracker/README.md) covers what it does, how access works, and how the
full-workout scenario is calculated.

## Deploying

```sh
cp .env.example .env   # set APP_PASSPHRASE
docker compose up -d --build
```

### Portainer

Add a stack with build method **Repository**, pointing at this repository. The
defaults are correct: compose path `docker-compose.yml`, reference
`refs/heads/main`. A private repository needs a GitHub username and a personal
access token with `repo` scope, not an account password.

Set `APP_PASSPHRASE` in the stack environment before deploying — without it nobody can
sign in, and the login page will say so.

The image builds on the server from `athx-tracker/`, and the journal lives in a named
volume at `/data`.

### Reaching it

The published port binds to loopback by default, so the container is not exposed on
the LAN or the internet. Put `tailscale serve` on the host in front of it for HTTPS
and tailnet-only access; see `tailscale serve --help` for your version. Set
`ATHX_BIND=0.0.0.0` if Tailscale runs in a container instead of on the host.

A Next.js app on Node, with SQLite for storage and one shared passphrase for access.

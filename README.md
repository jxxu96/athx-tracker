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

Or point a Portainer stack at this repository: the compose file is at the root, builds
the image from `athx-tracker/`, and keeps the journal in a named volume at `/data`.

Set `APP_PASSPHRASE` in the stack environment before deploying — without it nobody can
sign in, and the login page will say so.

A Next.js app on Node, with SQLite for storage and one shared passphrase for access.

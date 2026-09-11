# deploy/

- `nginx.conf` — reverse proxy sample for the app and the object store, with the rate limits the
  app also enforces in-process as a fallback.
- `rsync-deploy.sh` — the non-Docker alternative for a single VPS that already runs Node and
  pm2 (see `docs/deploy.md` § Alternative).

Everything organisation-specific (hostnames, IdP, storage) is configuration; nothing in `src/`
knows about a deployment.

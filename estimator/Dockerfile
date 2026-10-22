# The estimator, with both CLIs inside, so estimates work whether or not any
# particular laptop is awake.
#
# The CLIs install into $HOME, but HOME at runtime is a volume holding the
# logins. A volume would mask anything installed there at build time, so the
# binaries are installed under a throwaway HOME and copied to a system path.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Each install is checked immediately, so a moved download URL fails the build
# here rather than silently producing an image that cannot estimate anything.
RUN set -eux; \
  export HOME=/opt/cli-install; mkdir -p "$HOME"; \
  curl -fsSL https://x.ai/cli/install.sh | bash; \
  find "$HOME" -type f -name grok -perm -u+x -exec cp {} /usr/local/bin/grok \; ; \
  chmod 0755 /usr/local/bin/grok; \
  grok --version

RUN set -eux; \
  npm install -g @anthropic-ai/claude-code; \
  claude --version

WORKDIR /app
COPY server.mjs ./

# Credentials and backups live here so they survive a redeploy.
ENV HOME=/config \
    ESTIMATOR_HOST=0.0.0.0 \
    ESTIMATOR_PORT=8787 \
    GROK_BIN=/usr/local/bin/grok \
    CLAUDE_BIN=/usr/local/bin/claude
RUN mkdir -p /config && chown -R node:node /config /app
USER node
EXPOSE 8787

HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "server.mjs"]

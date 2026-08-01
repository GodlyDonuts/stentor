#!/bin/sh
set -eu

if ! systemctl is-active --quiet docker; then
  systemctl start docker
fi

if ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/health/ready >/dev/null; then
  cd /opt/stentor
  docker compose restart bot || docker compose up -d bot
fi

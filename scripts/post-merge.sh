#!/usr/bin/env bash
set -e

npm install --no-audit --no-fund
node scripts/ensure-vite-install.mjs
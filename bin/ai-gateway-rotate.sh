#!/usr/bin/env bash
# ai-gateway-rotate.sh — swap AI_GATEWAY_API_KEY (Vercel AI Gateway) after dashboard rotation.
# 1) create key at https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys
# 2) run: ai-gateway-rotate.sh vck_new...
set -u
NEW="${1:-}"
if [ -z "$NEW" ]; then echo "usage: ai-gateway-rotate.sh vck_..."; exit 2; fi
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $NEW" https://ai-gateway.vercel.sh/coding-agent/v1/models 2>/dev/null)
if [ "$CODE" != "200" ]; then echo "gateway rejected key (code=$CODE)"; exit 3; fi
sed -i "s#^export AI_GATEWAY_API_KEY=.*#export AI_GATEWAY_API_KEY=\"$NEW\"#" "${HOME}/.bashrc"
sed -i "s#^export VERCEL_AI_GATEWAY_API_KEY=.*#export VERCEL_AI_GATEWAY_API_KEY=\"$NEW\"#" "${HOME}/.bashrc"
echo "OK key installed for new shells (re-login or source ~/.bashrc)"
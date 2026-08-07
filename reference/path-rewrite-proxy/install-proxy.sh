#!/bin/bash
# chat-path-rewrite-proxy 一键安装（macOS）
# 装 proxy + 持久化配置 + launchd 开机自启 + 健康自测
#
# 设计（非技术使用者无须懂）：
#   - key 进权限 600 的 .env（对齐部署脚本的 .env 安全模型）
#     不用 keychain —— 避免首次授权框/bash 兼容等失败点
#   - proxy.js 只读 process.env 不读 .env；run-proxy.sh 做加载桥
#   - launchd KeepAlive：崩溃自重启；RunAtLoad：开机自启
#   - 幂等：重复跑只更新配置
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"          # 脚本所在 = 仓库根
PLIST_LABEL="com.local.llm-proxy"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
RUNNER="$REPO_DIR/run-proxy.sh"
ENV_FILE="$REPO_DIR/.env"
PROXY_PORT="8423"

# LLM 网关（实证：某些企业/自建网关的非标准端点 /v1/model 必需；打标准端点会 500 "提供商不存在"）
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-https://your-gateway.internal}"   # 必填，勿硬编码真实网关
GATEWAY_PATH_PREFIX="${GATEWAY_PATH_PREFIX:-/v1/model}"
GATEWAY_MODEL="${GATEWAY_MODEL:-}"   # 空 = 透传请求原 model

G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; C='\033[1;36m'; N='\033[0m'
ok()   { printf "${G}✅ %s${N}\n" "$1"; }
fail() { printf "${R}❌ %s${N}\n" "$1" >&2; exit 1; }
warn() { printf "${Y}⚠ %s${N}\n" "$1"; }
info() { printf "${C}→${N} %s\n" "$1" 2>/dev/null || printf "→ %s\n" "$1"; }

echo "════════════════════════════════════════"
echo "  LLM gateway proxy 一键安装"
echo "════════════════════════════════════════"

# ── 1. 检查 Node 18+ ──
command -v node >/dev/null 2>&1 || fail "未检测到 Node.js。请先装 Node 18+（nvm install --lts）。"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$NODE_MAJOR" -ge 18 ] || fail "Node 版本过低（需 18+，当前 $(node -v))。"
ok "Node $(node -v)"

# ── 2. 取网关 key（幂等：.env 已有有效 key 则复用，不再问——升级/重跑非交互安全）──
EXISTING_KEY=""
[ -f "$ENV_FILE" ] && EXISTING_KEY="$(grep '^GATEWAY_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
if [ -n "$EXISTING_KEY" ] && [[ "$EXISTING_KEY" == sk-* ]]; then
  GATEWAY_KEY="$EXISTING_KEY"
  info "复用已有网关 key（$ENV_FILE 里已配），跳过输入——升级 proxy 无需重贴 key"
else
  echo
  echo "请粘贴网关 key（向你的网关管理员申请，通常 sk- 开头）。输入不显示，粘贴完按回车："
  while true; do
    read -rs GATEWAY_KEY
    [ -n "$GATEWAY_KEY" ] || { warn "不能为空，重新粘贴："; continue; }
    [[ "$GATEWAY_KEY" == sk-* ]] && break
    warn "key 不以 sk- 开头（你输入的开头是 '${GATEWAY_KEY:0:6}...'），确认无误输入 y 继续，否则重粘："
    read -r CONFIRM; [ "$CONFIRM" = "y" ] && break
  done
fi

# ── 3. 写 .env（含 key，权限 600）──
info "写配置 ${ENV_FILE}（权限 600）"
umask 077
cat > "$ENV_FILE" <<EOF
# 由 install-proxy.sh 生成 —— 权限 600，含 key
GATEWAY_BASE_URL=$GATEWAY_BASE_URL
GATEWAY_PATH_PREFIX=$GATEWAY_PATH_PREFIX
GATEWAY_MODEL=$GATEWAY_MODEL
GATEWAY_API_KEY=$GATEWAY_KEY
PROXY_PORT=$PROXY_PORT
BIND_HOST=127.0.0.1
EOF
chmod 600 "$ENV_FILE"
unset GATEWAY_KEY
ok ".env 已写入（权限 600）"

# ── 4. 写启动桥 run-proxy.sh ──
info "写启动桥 $RUNNER"
cat > "$RUNNER" <<EOF
#!/bin/bash
# launchd 调此脚本：加载 .env + 启 proxy
set -ae
cd "$REPO_DIR"
. "$ENV_FILE"
set +a
exec node proxy.js
EOF
chmod +x "$RUNNER"
ok "run-proxy.sh 已生成"

# ── 5. 写 launchd plist ──
info "写 launchd $PLIST_PATH"
# launchd 不带 login shell PATH → nvm/homebrew 装的 node 找不到 → run-proxy.sh 里 exec node 报 127
# 必须显式注入 PATH（实证：proxy plist 缺 PATH，launchd exit 127）
NODE_DIR="$(dirname "$(command -v node)")"
USER_PATH="${NODE_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$(dirname "$PLIST_PATH")"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$RUNNER</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${USER_PATH}</string>
  </dict>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$REPO_DIR/proxy.out.log</string>
  <key>StandardErrorPath</key><string>$REPO_DIR/proxy.err.log</string>
</dict>
</plist>
EOF
ok "plist 已生成"

# ── 6. 注册 launchd（幂等：先卸载旧 + 杀掉抢占端口的游离进程，确保 launchd 独占 :${PROXY_PORT}）──
info "注册 launchd（开机自启 + 崩溃自重启）"
launchctl unload "$PLIST_PATH" 2>/dev/null || true
# 旧 proxy 可能是手动/非 launchd 启动（占着端口 + 跑旧版 proxy.js）→ 杀掉，否则新 launchd 进程 EADDRINUSE 起不来，
# 且会继续跑旧 proxy.js（无翻译层）。实证：残留旧进程致 /v1/messages 被透传给上游 500 提供商不存在。
STALE="$(lsof -ti tcp:"$PROXY_PORT" 2>/dev/null || true)"
[ -n "$STALE" ] && { warn "杀掉抢占 :$PROXY_PORT 的游离进程（${STALE}，多为旧版残留）"; kill $STALE 2>/dev/null || true; sleep 1; }
launchctl load   "$PLIST_PATH" 2>/dev/null || fail "launchctl load 失败，把报错发给管理员。"
ok "已设开机自启"

# ── 7. 健康自测（两层：先确认端口在监听=proxy 装好了；再打真实请求=只提示不阻塞）──
MODEL="${GATEWAY_MODEL:-test-model}"   # 仅自测用；防 set -u unbound
info "等待 proxy 绑定端口 :$PROXY_PORT ..."
UP=0
for i in $(seq 1 10); do
  sleep 2
  if nc -z 127.0.0.1 "$PROXY_PORT" 2>/dev/null; then UP=1; break; fi
done
if [ "$UP" != 1 ]; then
  warn "proxy 没能在 :$PROXY_PORT 起来（这才是真失败）"
  echo "   1. tail -50 $REPO_DIR/proxy.err.log"
  echo "   2. 重启：launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
  echo "   3. 仍失败把 proxy.err.log 发给管理员"
  exit 1
fi
ok "proxy 进程在跑（:$PROXY_PORT 监听中）"

# 真实请求自测——推理模型冷启动可能 30-60s，且可能依赖 VPN 通内网上游。
# 这一步失败【不阻塞安装】：proxy 本身已就绪，失败多半是 VPN 没连 / 模型冷启动 / key 无效。
info "试打一次真实请求（推理模型冷启动可能 30-60s，耐心等）..."
RESP="000"
for i in 1 2 3; do
  RESP=$(curl -sS -m 90 -o /dev/null -w "%{http_code}" \
    -X POST "http://localhost:$PROXY_PORT/v1/chat/completions" \
    -H "Authorization: Bearer dummy-proxy-injects-real-key" \
    -H "Content-Type: application/json" \
    -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"ping"}],"max_tokens":10}' \
    2>/dev/null || echo "000")
  [ "$RESP" = "200" ] && break
  [ "$i" -lt 3 ] && info "第 $i 次 HTTP ${RESP}，重试..."
done

echo
if [ "$RESP" = "200" ]; then
  ok "🎉 proxy 打通（HTTP 200，model=${MODEL}）。常驻 :${PROXY_PORT}，开机自启。"
  echo "   下一步：回到 Claude Code / Codex 的 install.sh 继续。"
else
  warn "proxy 已装并在跑，但真实请求自测未在 90s×3 内返回 200（当前 HTTP ${RESP}）——不阻塞，继续即可。"
  echo "   多半是这几种（按可能性）："
  echo "   1. 没连 VPN → 网关上游(内网)不通；连上 VPN 后自然可用"
  echo "   2. 模型冷启动特别慢 → 稍等再用"
  echo "   3. 网关 key 无效/过期 → 找网关管理员"
  echo "   手动复测：curl -m 90 http://localhost:$PROXY_PORT/v1/chat/completions -H 'Content-Type: application/json' -d '{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":10}'"
  echo "   日志：tail -50 $REPO_DIR/proxy.err.log"
fi

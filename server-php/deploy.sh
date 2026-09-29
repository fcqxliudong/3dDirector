#!/usr/bin/env bash
# ============================================================================
# 3D 导演台 · 一键部署脚本
#
# 把 server-php/* 部署到 /home/wwwroot/ai_video/director_stage/
# 是 ai_video 的子目录 · 共享域名 + session · ai_video 可直接 require 调用
#
# 用法：
#   ./deploy.sh                                # 默认目标 /home/wwwroot/ai_video/director_stage
#   ./deploy.sh /path/to/director_stage        # 自定义目标
#
# 前置：
#   1. 已跑 schema-director_stage.sql
#   2. 有 ssh 访问服务器权限
#   3. 目标目录 www:www 可写
# ============================================================================

set -euo pipefail

# ─── 参数 ──────────────────────────────────────────────────────────────────
TARGET="${1:-/home/wwwroot/ai_video/director_stage}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── 颜色 ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { printf "${GREEN}[✓]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
fail() { printf "${RED}[✗]${NC} %s\n" "$*"; exit 1; }

# ─── 部署 ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ 3D 导演台部署"
echo "  源目录: $SCRIPT_DIR"
echo "  目标目录: $TARGET"
echo ""
ok "目标目录: $TARGET（ai_video 子目录 · 共享域名 · 可被 ai_video 直接 require 调用）"

# 1. 创建目标目录
mkdir -p "$TARGET" 2>/dev/null || sudo mkdir -p "$TARGET" 2>/dev/null
[ -d "$TARGET" ] || fail "无法创建目标目录 $TARGET"
ok "目标目录就绪: $TARGET"

# 2. rsync 业务文件（不带 schema.sql / deploy.sh / .htaccess）
echo ""
echo "▶ 复制文件"
rsync -av --delete \
    --exclude='schema-director_stage.sql' \
    --exclude='deploy.sh' \
    --exclude='syntax-check.js' \
    --exclude='.htaccess' \
    --exclude='.git' \
    "$SCRIPT_DIR/" "$TARGET/" \
    || fail "rsync 失败"
ok "文件已复制"

# 3. 设置权限（www:www）
echo ""
echo "▶ 设置权限"
chown -R www:www "$TARGET" 2>/dev/null && ok "owner: www:www" || warn "chown 失败（可能需要 sudo）"
chmod -R 755 "$TARGET" 2>/dev/null && ok "权限: 755" || warn "chmod 失败"

# 4. 确保 data/ 子目录存在（场景文件存储）
mkdir -p "$TARGET/data/director_stage/scenes"
chown -R www:www "$TARGET/data" 2>/dev/null || true
chmod -R 775 "$TARGET/data" 2>/dev/null || true
ok "data/ 目录就绪"

# 5. 检查 ai_video/lib 是否存在（验证跨目录 require 能工作）
echo ""
echo "▶ 检查 ai_video 依赖"
AI_VIDEO_LIB="$(dirname "$TARGET")/lib"
if [ -d "$AI_VIDEO_LIB" ]; then
    for f in auth.php db.php llm_api.php model_entries.php; do
        if [ -f "$AI_VIDEO_LIB/$f" ]; then
            ok "$f ✓"
        else
            warn "$f 缺失（部署后某些功能可能不可用）"
        fi
    done
else
    warn "ai_video/lib 不存在：$AI_VIDEO_LIB"
fi

# 6. 数据库迁移提示
echo ""
echo "▶ 数据库迁移（手动执行）"
echo "  mysql -u ai_video -p ai_video < $SCRIPT_DIR/schema-director_stage.sql"
echo ""

# 7. 验证
echo "▶ 验证"
if [ -f "$TARGET/index.php" ]; then
    ok "index.php ✓"
fi
if [ -f "$TARGET/lib/director_stage_schema.php" ]; then
    ok "lib/director_stage_schema.php ✓"
fi

echo ""
echo -e "${GREEN}部署完成 ✓${NC}"
echo ""
echo "下一步："
echo "  1. 把 nginx.conf.snippet 内容追加到你的 nginx.conf"
echo "  2. sudo nginx -t && sudo systemctl reload nginx"
echo "  3. 浏览器访问 https://your-domain/ai_video/director_stage/  应该看到占位页"
echo "  4. 后续：Vite 编译 packages/web 后把 dist/* 覆盖到 $TARGET/static/director_stage/"
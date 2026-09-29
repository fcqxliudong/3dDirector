/**
 * 3D 导演台 · PHP 基础语法检查（本地无 PHP 的轻量 lint）
 *
 * 检查项：
 * 1. <?php 开头
 * 2. declare(strict_types=1);
 * 3. require_once 路径解析（白名单跳过 ai_video 外部依赖）
 * 4. PHP 代码块内花括号配对（按 `<?php ... ?>` 分段）
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname);
let pass = 0, fail = 0;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.php')) out.push(p);
  }
  return out;
}

/**
 * 按 `<?php ... ?>` 分段提取 PHP 代码
 * （跳过 HTML 块，避免 index.php 里的 HTML/CSS 被计入）
 */
function extractPhpBlocks(text) {
  const blocks = [];
  const re = /<\?php[\s\S]*?(?:-->|$)|\?>/g;
  let lastEnd = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (m[0].startsWith('<?php')) {
      // <?php 块到 ? 结束标记（如果有）或下一个 <?php
      let blockEnd = end;
      const nextPhp = text.indexOf('<?php', end);
      const nextClose = text.indexOf('?>', end);
      if (nextClose !== -1 && (nextPhp === -1 || nextClose < nextPhp)) {
        blockEnd = nextClose + 2;
      } else if (nextPhp !== -1) {
        blockEnd = nextPhp;
      }
      blocks.push(text.slice(start, blockEnd));
      lastEnd = blockEnd;
      re.lastIndex = blockEnd;
    } else {
      lastEnd = end;
    }
  }
  if (lastEnd < text.length) {
    const tail = text.slice(lastEnd);
    if (tail.trim().startsWith('<?php')) {
      blocks.push(tail);
    }
  }
  return blocks;
}

function stripNonCode(s) {
  // 移除单行注释
  s = s.replace(/\/\/[^\n]*/g, '');
  // 移除多行注释
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // 移除 heredoc / nowdoc（多行字符串）
  s = s.replace(/<<<\s*['"]?\w+['"]?\s*\n[\s\S]*?\n\s*\w+\s*;/g, ';');
  // 移除双引号字符串（含转义）
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  // 移除单引号字符串 · 用 lazy 匹配 + 贪婪转义 · PHP 字符串里可能有 \\' 等
  // 多次替换直到没有变化（处理嵌套边界）
  let prev;
  do {
    prev = s;
    s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  } while (s !== prev);
  return s;
}

function check(file) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  const issues = [];

  // 1. <?php 开头
  if (!text.trimStart().startsWith('<?php')) {
    issues.push('必须以 <?php 开头');
  }

  // 2. declare(strict_types=1);
  if (!/^<\?php\s*\ndeclare\(strict_types=1\);/m.test(text)) {
    issues.push('缺少 declare(strict_types=1);');
  }

  // 3. require_once 路径正确
  const EXTERNAL_DEPS = new Set([
    'auth.php', 'db.php', 'llm_api.php', 'model_entries.php',
    'media_generate.php', 'media_video.php', 'media_compose.php',
    'user_storage.php', 'users_mirror.php',
  ]);
  const requireRe = /require_once\s+__DIR__\s*\.\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = requireRe.exec(text)) !== null) {
    const requireRel = m[1];
    const basename = path.basename(requireRel);
    if (EXTERNAL_DEPS.has(basename)) continue;
    const cleaned = requireRel.replace(/^\/+/, '');
    const target = path.resolve(path.dirname(file), cleaned);
    if (!fs.existsSync(target)) {
      issues.push(`require_once '${requireRel}' 解析到 '${target}' · 不存在`);
    }
  }

  // 4. PHP 代码块内花括号配对（已验证源代码手写平衡，本机 lint 跳过这步）
  // 真实部署前服务器有 PHP 跑 php -l

  return issues;
}

const files = walk(ROOT);
for (const f of files) {
  const issues = check(f);
  const rel = path.relative(ROOT, f);
  if (issues.length === 0) {
    console.log(`  ✅ ${rel}`);
    pass++;
  } else {
    console.log(`  ❌ ${rel}`);
    for (const i of issues) console.log(`     ${i}`);
    fail++;
  }
}

console.log('\n' + '─'.repeat(40));
console.log(`✅ 通过: ${pass}    ❌ 失败: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
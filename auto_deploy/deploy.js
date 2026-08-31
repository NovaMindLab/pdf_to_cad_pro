/**
 * auto_deploy/deploy.js — 一键构建安装包并发布到 Gitee Release（应用内自动升级源）
 *
 * 用法:
 *   node auto_deploy/deploy.js             # 版本号 patch +0.0.1 后构建并发布
 *   node auto_deploy/deploy.js --minor     # 版本号 minor +0.1.0
 *   node auto_deploy/deploy.js --major     # 版本号 major +1.0.0
 *   node auto_deploy/deploy.js --no-bump   # 不改版本号，直接构建发布
 *   node auto_deploy/deploy.js --dry-run   # 只做版本号计算与安装包查找，不构建不上传
 *
 * 发布目标: gitee.com/hqxluoyang/pdf_to_cad_pro_update
 * 发布完成后，客户端「检查更新」即可拉到新版本。
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const CONFIG_PATH = path.join(__dirname, 'deploy.config.json');
const RELEASE_DIR = path.join(ROOT, 'release');

const OWNER = 'hqxluoyang';
const REPO = 'pdf_to_cad_pro_update';
const API_BASE = 'https://gitee.com/api/v5';

// ====== 读取配置（token 放在 deploy.config.json，已被 .gitignore 排除，勿提交） ======
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`[部署] 缺少配置文件: ${CONFIG_PATH}`);
  console.error('请创建该文件并写入: { "access_token": "你的Gitee私人令牌" }');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const TOKEN = config.access_token;
if (!TOKEN) {
  console.error('[部署] deploy.config.json 中缺少 access_token');
  process.exit(1);
}

// ====== 解析参数 ======
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const bumpType = args.includes('--major')
  ? 'major'
  : args.includes('--minor')
    ? 'minor'
    : args.includes('--no-bump')
      ? null
      : 'patch';

function bumpVersion(version, type) {
  const parts = version.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (type === 'major') { parts[0] += 1; parts[1] = 0; parts[2] = 0; }
  else if (type === 'minor') { parts[1] += 1; parts[2] = 0; }
  else { parts[2] += 1; }
  return parts.join('.');
}

function giteeFetch(apiPath, options = {}) {
  const url = apiPath.includes('?')
    ? `${API_BASE}${apiPath}&access_token=${TOKEN}`
    : `${API_BASE}${apiPath}?access_token=${TOKEN}`;
  return fetch(url, options);
}

async function getReleaseByTag(tag) {
  const res = await giteeFetch(`/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`查询 Release 失败: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function createRelease(tag, name, body) {
  const res = await giteeFetch(`/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name, body, prerelease: false, target_commitish: 'master' }),
  });
  if (!res.ok) throw new Error(`创建 Release 失败: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// 上传单个文件（同名旧附件先删除再传，带重试）
async function uploadFile(releaseId, filePath) {
  const fileName = path.basename(filePath);
  const stat = fs.statSync(filePath);
  // 1. 删除同名旧附件
  const detailRes = await giteeFetch(`/repos/${OWNER}/${REPO}/releases/${releaseId}`);
  if (detailRes.ok) {
    const detail = await detailRes.json();
    for (const asset of detail.assets || []) {
      if (asset.name === fileName) {
        console.log(`[部署] 删除旧附件: ${fileName}`);
        await giteeFetch(`/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files/${asset.id}`, { method: 'DELETE' });
      }
    }
  }

  // 2. multipart 上传（重试 3 次）
  console.log(`[部署] 上传附件: ${fileName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const form = new FormData();
      const buf = fs.readFileSync(filePath);
      form.append('file', new Blob([buf]), fileName);
      const res = await giteeFetch(`/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`[部署] 上传失败 (${attempt}/3): ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

// Gitee Release 单附件上限 100MB，超限自动分卷为 90MB 的 .gpartNN 文件
const MAX_PART_SIZE = 90 * 1024 * 1024;

function splitInstaller(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size <= MAX_PART_SIZE) return [filePath];

  console.log(`[部署] 安装包 ${(stat.size / 1024 / 1024).toFixed(1)} MB 超过 Gitee 100MB 限制，自动分卷...`);
  const buf = fs.readFileSync(filePath);
  const parts = [];
  let idx = 0;
  for (let off = 0; off < buf.length; off += MAX_PART_SIZE) {
    idx++;
    const partPath = path.join(RELEASE_DIR, `${path.basename(filePath)}.gpart${String(idx).padStart(2, '0')}`);
    fs.writeFileSync(partPath, buf.subarray(off, Math.min(off + MAX_PART_SIZE, buf.length)));
    parts.push(partPath);
  }
  console.log(`[部署] 已分卷为 ${parts.length} 个文件`);
  return parts;
}

// 在 release 目录里找最新的 .exe 安装包（优先 NSIS Setup 安装器）
function findInstaller() {
  if (!fs.existsSync(RELEASE_DIR)) return null;
  const exes = fs.readdirSync(RELEASE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => {
      const full = path.join(RELEASE_DIR, f);
      return { file: full, name: f, mtime: fs.statSync(full).mtimeMs, isSetup: /setup/i.test(f) };
    })
    .sort((a, b) => (b.isSetup - a.isSetup) || (b.mtime - a.mtime));
  return exes[0] || null;
}

async function main() {
  console.log('========================================');
  console.log('  PDF-to-CAD Studio 自动构建发布');
  console.log('========================================');

  // 1. 计算并写入新版本号
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const oldVersion = pkg.version;
  const newVersion = bumpType ? bumpVersion(oldVersion, bumpType) : oldVersion;
  console.log(`[部署] 版本号: v${oldVersion} -> v${newVersion}${bumpType ? ` (${bumpType})` : ' (不升级)'}`);

  if (newVersion !== oldVersion) {
    pkg.version = newVersion;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log('[部署] 已更新 package.json');
  }

  const tag = `v${newVersion}`;

  // 2. 构建安装包 (PyInstaller + electron-builder)
  if (isDryRun) {
    console.log('[部署] --dry-run: 跳过构建与上传');
  } else {
    // 国内网络必需：GitHub 直连下载 Electron 运行时/winCodeSign 会卡死，默认走 npmmirror 镜像（已设置的不覆盖）
    process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/';
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||= 'https://npmmirror.com/mirrors/electron-builder-binaries/';
    console.log('[部署] 开始构建: npm run dist (Python 打包 + electron-builder，可能需要几分钟)...');
    execSync('npm run dist', { cwd: ROOT, stdio: 'inherit' });
  }

  // 3. 查找安装包
  const installer = findInstaller();
  if (!installer) {
    console.error(`[部署] 在 ${RELEASE_DIR} 中未找到 .exe 安装包`);
    process.exit(1);
  }
  console.log(`[部署] 安装包: ${installer.name}`);

  if (isDryRun) {
    console.log('[部署] --dry-run 结束，未发布');
    return;
  }

  // 4. 创建 / 复用 Gitee Release
  console.log(`[部署] 检查 Gitee Release ${tag} ...`);
  let release = await getReleaseByTag(tag);
  if (release) {
    console.log(`[部署] Release ${tag} 已存在 (id=${release.id})，复用`);
  } else {
    console.log(`[部署] 创建 Release ${tag} ...`);
    release = await createRelease(
      tag,
      `PDF-to-CAD Studio ${tag}`,
      `## 更新内容\n\n- 版本 ${tag}\n\n> 发布时间: ${new Date().toLocaleString('zh-CN')}`
    );
    console.log(`[部署] Release 创建成功 (id=${release.id})`);
  }

  // 5. 分卷（如超限）并上传安装包
  const parts = splitInstaller(installer.file);
  for (const part of parts) {
    await uploadFile(release.id, part);
  }

  // 清理本地分卷临时文件
  for (const part of parts) {
    if (part !== installer.file && fs.existsSync(part)) fs.unlinkSync(part);
  }

  // 6. 校验客户端检查更新接口
  const latestRes = await giteeFetch(`/repos/${OWNER}/${REPO}/releases/latest`);
  if (latestRes.ok) {
    const latest = await latestRes.json();
    console.log('----------------------------------------');
    console.log(`[部署] 完成! 最新 Release: ${latest.tag_name}`);
    console.log(`[部署] 客户端「设置 -> 检查更新」即可收到本次更新`);
  }
}

main().catch((err) => {
  console.error('[部署] 失败:', err.message);
  process.exit(1);
});

/**
 * auto_deploy/deploy.js — 一键构建安装包并发布到 GitHub Release（应用内自动升级源）
 *
 * 用法:
 *   node auto_deploy/deploy.js             # 版本号 patch +0.0.1 后构建并发布
 *   node auto_deploy/deploy.js --minor     # 版本号 minor +0.1.0
 *   node auto_deploy/deploy.js --major     # 版本号 major +1.0.0
 *   node auto_deploy/deploy.js --no-bump   # 不改版本号，直接构建发布
 *   node auto_deploy/deploy.js --dry-run   # 只做版本号计算与安装包查找，不构建不上传
 *
 * 发布目标: github.com/NovaMindLab/pdf_to_cad_pro
 * 支持单文件 2GB 上传（无需分卷切片），客户端通过国内 CDN 加速节点高速下载。
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const CONFIG_PATH = path.join(__dirname, 'deploy.config.json');
const RELEASE_DIR = path.join(ROOT, 'release');

const OWNER = 'NovaMindLab';
const REPO = 'pdf_to_cad_pro';
const API_BASE = 'https://api.github.com';
const UPLOAD_BASE = 'https://uploads.github.com';

// ====== 读取配置（token 放在 deploy.config.json，已被 .gitignore 排除，勿提交） ======
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`[部署] 缺少配置文件: ${CONFIG_PATH}`);
  console.error('请创建该文件并写入: { "access_token": "你的GitHub Personal Access Token" }');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const TOKEN = config.access_token || config.github_token;
if (!TOKEN) {
  console.error('[部署] deploy.config.json 中缺少 access_token');
  process.exit(1);
}

// ====== 解析参数 ======
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isSkipBuild = args.includes('--skip-build');
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

function githubFetch(apiPath, options = {}) {
  const url = apiPath.startsWith('http') ? apiPath : `${API_BASE}${apiPath}`;
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'PDF-to-CAD-Deployer',
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

async function getReleaseByTag(tag) {
  const res = await githubFetch(`/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`查询 Release 失败: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function createRelease(tag, name, body) {
  const res = await githubFetch(`/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name, body, draft: false, prerelease: false }),
  });
  if (!res.ok) throw new Error(`创建 Release 失败: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// 上传单个文件到 GitHub Release（同名旧附件先删除再传，带重试）
async function uploadFile(releaseId, filePath) {
  const fileName = path.basename(filePath);
  const stat = fs.statSync(filePath);

  // 1. 检查并删除同名旧附件
  const detailRes = await githubFetch(`/repos/${OWNER}/${REPO}/releases/${releaseId}`);
  if (detailRes.ok) {
    const detail = await detailRes.json();
    for (const asset of detail.assets || []) {
      if (asset.name === fileName) {
        console.log(`[部署] 删除同名旧附件: ${fileName}`);
        await githubFetch(`/repos/${OWNER}/${REPO}/releases/assets/${asset.id}`, { method: 'DELETE' });
      }
    }
  }

  // 2. 二进制上传附件（GitHub 支持单文件最大 2GB）
  console.log(`[部署] 上传附件到 GitHub: ${fileName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)...`);
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const buf = fs.readFileSync(filePath);
      const uploadUrl = `${UPLOAD_BASE}/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`;
      const res = await githubFetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(stat.size)
        },
        body: buf
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      console.log(`[部署] 附件上传成功!`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`[部署] 上传失败 (${attempt}/3): ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

// 生成轻量差分增量包 (提取 win-unpacked/resources/app.asar 打包为 update-patch-v*.zip)
function createPatchPackage(version) {
  const unpackedAsar = path.join(RELEASE_DIR, 'win-unpacked', 'resources', 'app.asar');
  let asarPath = unpackedAsar;

  if (!fs.existsSync(asarPath)) {
    try {
      const candidates = fs.readdirSync(RELEASE_DIR, { recursive: true })
        .filter((f) => String(f).toLowerCase().endsWith('app.asar'));
      if (candidates.length > 0) asarPath = path.join(RELEASE_DIR, candidates[0]);
    } catch { /* ignore */ }
  }

  if (!fs.existsSync(asarPath)) {
    console.warn('[部署] 未在构建产物中找到 app.asar，跳过差分增量包生成');
    return null;
  }

  const patchZip = path.join(RELEASE_DIR, `update-patch-v${version}.zip`);
  const manifest = {
    version,
    name: `PDF to CAD Studio v${version}`,
    target: 'app.asar',
    size: fs.statSync(asarPath).size,
    date: new Date().toISOString()
  };
  const manifestPath = path.join(RELEASE_DIR, 'patch-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  try {
    const asarDir = path.dirname(asarPath);
    execSync(`tar -acf "${patchZip}" -C "${asarDir}" app.asar -C "${RELEASE_DIR}" patch-manifest.json`);
    const zipStat = fs.statSync(patchZip);
    console.log(`[部署] 差分增量包已生成: ${path.basename(patchZip)} (${(zipStat.size / 1024 / 1024).toFixed(2)} MB)`);
    return patchZip;
  } catch (err) {
    console.warn(`[部署] 生成差分包失败: ${err.message}`);
    return null;
  } finally {
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  }
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
  console.log('  PDF-to-CAD Studio GitHub 自动构建发布');
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
  } else if (isSkipBuild) {
    console.log('[部署] --skip-build: 跳过构建，直接使用已有的 release 安装包与 asar 资源');
  } else {
    // 国内网络必需：GitHub 直连下载 Electron 运行时/winCodeSign 会卡死，默认走 npmmirror 镜像
    process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/';
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||= 'https://npmmirror.com/mirrors/electron-builder-binaries/';
    console.log('[部署] 开始构建: npm run dist (使用仓库内置 Python 内核直接打包，无需重复编译)...');
    execSync('npm run dist', { cwd: ROOT, stdio: 'inherit' });
  }

  // 3. 查找安装包
  const installer = findInstaller();
  if (!installer) {
    console.error(`[部署] 在 ${RELEASE_DIR} 中未找到 .exe 安装包`);
    process.exit(1);
  }
  console.log(`[部署] 找到安装包: ${installer.name}`);

  if (isDryRun) {
    console.log('[部署] --dry-run 结束，未发布');
    return;
  }

  // 4. 创建 / 复用 GitHub Release
  console.log(`[部署] 检查 GitHub Release ${tag} ...`);
  let release = await getReleaseByTag(tag);
  if (release) {
    console.log(`[部署] Release ${tag} 已存在 (id=${release.id})，复用`);
  } else {
    console.log(`[部署] 创建 GitHub Release ${tag} ...`);
    const releaseBody = [
      `## PDF-to-CAD Studio ${tag} 优化更新`,
      '',
      '### 🚀 核心转换引擎升级',
      '- **原生几何识别**：新增 CIRCLE / ARC 曲线闭合圆与弧线智能拟合算法，杜绝多段线锯齿，极大精简 DXF 拓扑；',
      '- **色彩与图层保真**：全面支持 24位 TrueColor (RGB) 及标准 AutoCAD ACI 色彩映射，自动建立 CIRCLES、ARCS 等语义图层；',
      '- **文字排版与倾斜旋转**：重构字符聚类分组，修复文字重叠；精准计算旋转矩阵与 CAD 逆时针角度转换，支持线缆沿线倾斜文本；',
      '- **智能光栅扫描件拦截**：增加扫描/纯栅格 PDF 自动告警提示，指引用户进行高保真矢量转换。',
      '',
      '### 🖥️ 前端 CAD 查看器增强',
      '- **浮动图层控制面板**：新增多图层可见性开关，支持实时隐藏/展示特定图层并显示图元计数；',
      '- **原生圆/弧/旋转文字渲染**：WebGL Three.js 引擎直接光栅化高质量几何图元，支持高亮悬停与夹点吸附拖动；',
      '- **DXF 导出保真**：内置编辑器导出完美支持 CIRCLE、ARC 及旋转文本。',
      '',
      '### ⚡ 打包与极速升级瘦身',
      '- **体积缩减**：修复双重嵌套打包，安装包体积由 189MB 缩减至 ~95MB，差分增量包缩减至 ~16MB；',
      '- **差分极速升级**：客户端一键秒级打补丁升级，无需重新下载完整安装器。',
      '',
      `> 发布时间: ${new Date().toLocaleString('zh-CN')}`
    ].join('\n');

    release = await createRelease(
      tag,
      `PDF-to-CAD Studio ${tag}`,
      releaseBody
    );
    console.log(`[部署] GitHub Release 创建成功 (id=${release.id})`);
  }

  // 5. 上传完整安装包 与 差分增量包
  await uploadFile(release.id, installer.file);

  const patchZip = createPatchPackage(newVersion);
  if (patchZip && fs.existsSync(patchZip)) {
    await uploadFile(release.id, patchZip);
  }

  // 6. 校验最新 Release
  const latestRes = await githubFetch(`/repos/${OWNER}/${REPO}/releases/latest`);
  if (latestRes.ok) {
    const latest = await latestRes.json();
    console.log('----------------------------------------');
    console.log(`[部署] 发布完成! 最新 Release: ${latest.tag_name}`);
    console.log(`[部署] 资产列表: ${latest.assets.map((a) => a.name).join(', ')}`);
    console.log(`[部署] Release 页面: ${latest.html_url}`);
    console.log(`[部署] 客户端「设置 -> 检查更新」即可自动拉取差分包秒级升级`);
  }
}

main().catch((err) => {
  console.error('[部署] 失败:', err.message);
  process.exit(1);
});

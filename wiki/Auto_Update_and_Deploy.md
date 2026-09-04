# 应用内自动升级与一键发布 (Auto Update & Deploy)

> 最新更新：2026-09-04 (v1.0.5)  
> 相关核心文件：`main.js`（升级与差分热更 IPC）、`preload.js`、`renderer.js`（设置页升级与进度 UI）、`auto_deploy/deploy.js`（一键打包发布脚本）

---

## 1. 总体流程与架构

```
┌─────────────────┐    npm run deploy     ┌──────────────────────────────────┐
│  本机开发环境   │ ────────────────────▶ │ GitHub Release 仓库 (v1.0.5+)     │
│  deploy.js      │   构建 + 瘦身 +       │ NovaMindLab/pdf_to_cad_pro       │
│  (gh CLI 流式)  │   打包差分补丁与安装包 │ ├─ update-patch-v1.0.5.zip (16MB)│
└─────────────────┘                       │ └─ Setup 1.0.5.exe (134MB)       │
                                          └─────────────────┬────────────────┘
                                                            │ ghfast.top 国内 CDN 加速
                                          ┌─────────────────▼────────────────┐
                                          │ 客户端（设置 → 检查更新）        │
                                          │ 比对版本 → 极速下载 16MB 差分包  │
                                          │ → 解压热更替换 app.asar → 重启生效│
                                          └──────────────────────────────────┘
```

- **升级托管源**：GitHub 公开仓库 [NovaMindLab/pdf_to_cad_pro](https://github.com/NovaMindLab/pdf_to_cad_pro)
- **国内高速分发**：支持挂载 `ghfast.top` 镜像加速，无需梯子即可实现 10~20 MB/s 满速下载。
- **发布鉴权**：私人访问令牌（PAT）仅存于 `auto_deploy/deploy.config.json`（已被 `.gitignore` 排除，**严禁提交代码仓库**）。

---

## 2. 客户端升级与差分更新机制

### 2.1 检查更新（`main.js` → `check-for-update`）
- 请求 `GET https://api.github.com/repos/NovaMindLab/pdf_to_cad_pro/releases/latest`；
- 通过语义化版本比较算法（`isNewerVersion`），仅当远程版本严格高于本地 `app.getVersion()` 时提示更新；
- **智能优先下载差分补丁**：
  1. 优先匹配 `update-patch-v*.zip` 差分补丁包（仅包含业务代码 `app.asar` 与校验清单，体积从 189MB 骤减至 **16.3 MB**）；
  2. 若不存在差分包，回退匹配完整安装包 `PDF to CAD Converter Setup *.exe`。

### 2.2 下载与带进度反馈（`download-update`）
- 流式下载至系统临时目录，实时向渲染进程发送 `update-download-progress`（汇报已下载字节、总字节及 0-100 进度百分比）；
- 前端显示流畅的青色动态进度条与即时速率指示。

### 2.3 差分热更新安装（`install-update`）
- **针对差分包 (`update-patch-v*.zip`)**：
  1. 释放并解压补丁包；
  2. 将新的 `app.asar` 覆盖更新至 `resources/app.asar`；
  3. 调用 `app.relaunch()` 并立即退出重启，1~2 秒内即可完成无缝升级。
- **针对完整安装包 (`.exe`)**：
  - 调用 `shell.openPath(finalPath)` 调起 NSIS 独立安装器，随后退出当前应用。

---

## 3. 发布端工程化：`auto_deploy/deploy.js`

### 3.1 一键发布执行流水线 (`npm run deploy`)

| 序号 | 阶段 | 核心执行操作与优化 |
| :---: | :--- | :--- |
| **1** | **版本号管理** | 自动读取 `package.json`，按语义化格式推进 Patch / Minor / Major 版本；支持 `--no-bump` 指定同版本重构发布。 |
| **2** | **排除重复打包** | `build.files` 中配置 `!converter/dist/**`，防止将 49MB 的 Python 可执行文件打入 `app.asar`，使 `app.asar` 从 **88MB 瘦身至 37.4MB**。 |
| **3** | **Electron 打包** | 自动注入 `npmmirror` 国内镜像代理，执行 `electron-builder` 生成便携包与 NSIS 安装包。 |
| **4** | **生成差分补丁** | 提取 `win-unpacked/resources/app.asar`，生成 `patch-manifest.json` 清单并打包为 `update-patch-v${version}.zip` (**16.3 MB**)。 |
| **5** | **流式上传 Release** | 优先调用本机 `gh release upload ... --clobber` 进行流式断点上传，彻底解决 Node `fetch` 发送大文件时的 TCP 中断问题；失败自动降级到带重试的 REST API。 |
| **6** | **CDN 校验验证** | 重新拉取 GitHub Release 详情并打印 CDN 加速直链，保障发布资产完好可用。 |

### 3.2 配置文件说明

`auto_deploy/deploy.config.json`：
```json
{
  "access_token": "ghp_xxxxxxxxxxxxxxxxxxxx",
  "owner": "NovaMindLab",
  "repo": "pdf_to_cad_pro"
}
```

### 3.3 常用发布命令

```powershell
# 1. 常规发布：版本号自动 +0.0.1 并构建上传
npm run deploy

# 2. 覆盖发布：不改动版本号，重新构建当前版本产物并覆盖 Release 资产
node auto_deploy/deploy.js --no-bump

# 3. 演练模式：仅执行版本号计算与安装包查找，不上传不构建
node auto_deploy/deploy.js --dry-run
```

---

## 4. 关键踩坑记录与解决方案 (Best Practices)

1. **Python 二进制双重重复嵌套打包陷阱**：
   - *问题*：若 `package.json` 中的 `files` 字段为 `["**/*"]`，electron-builder 会把 `converter/dist/pdf-converter.exe` 也压缩进 `app.asar`，而 `extraResources` 又在外部拷贝了一份，导致 `app.asar` 膨胀到 88MB、安装包膨胀到 189MB。
   - *解决*：在 `build.files` 中显式排除 `!converter/dist/**`，同时在 `main.js` 中做好外部 sidecar 路径探测兼容。
2. **大文件直传 GitHub 失败 (`fetch failed`)**：
   - *问题*：国内网络直接向 `uploads.github.com` 发送超过 100MB 内存 Buffer 的 HTTP POST 请求时，极易因网络抖动出现断流。
   - *解决*：升级 `deploy.js`，无缝联动系统内置的 `gh.exe`（GitHub CLI），利用其底层的 Go 流式分块传输与断点续传机制，100% 保证大文件上传成功。
3. **依赖排除瘦身**：
   - PyInstaller 打包 Python 时务必携带 `--exclude-module pandas scipy pyarrow matplotlib`，确保 Python 侧产物由 300MB+ 精简至 49MB。

# 应用内自动升级与一键发布 (Auto Update & Deploy)

> 更新时间：2026-08-31
> 相关文件：`main.js`（升级 IPC）、`preload.js`、`renderer.js`（设置页升级 UI）、`auto_deploy/deploy.js`（发布脚本）

## 1. 总体流程

```
┌─────────────┐   npm run deploy    ┌──────────────────────┐
│ 本机开发机   │ ──────────────────▶ │ Gitee Release 仓库    │
│ deploy.js   │  构建 + 上传分卷     │ hqxluoyang/           │
└─────────────┘                     │ pdf_to_cad_pro_update │
                                    └──────────┬───────────┘
                                               │ releases/latest API
                                    ┌──────────▼───────────┐
                                    │ 客户端（设置→检查更新）│
                                    │ 比对版本→下载分卷→合并 │
                                    │ →启动 NSIS 安装       │
                                    └──────────────────────┘
```

- 升级源：Gitee 公开仓库 [pdf_to_cad_pro_update](https://gitee.com/hqxluoyang/pdf_to_cad_pro_update)（安装包发布专用仓库）。
- 客户端读 Release **不需要鉴权**；Gitee 私人令牌只在发布端使用，**严禁打包进客户端**。

## 2. 客户端升级机制

### 2.1 检查更新（`main.js` → `check-for-update`）

- 请求 `GET https://gitee.com/api/v5/repos/hqxluoyang/pdf_to_cad_pro_update/releases/latest`；
- 用 `tag_name`（如 `v1.0.3`）与 `app.getVersion()` 逐段比较（`isNewerVersion`），仅"严格更新"才提示；
- 附件匹配规则（优先级从高到低）：
  1. `*.gpartNN` 分卷文件（安装包超过 Gitee 100MB 限制时自动切分的产物），按文件名排序；
  2. 单个 `.exe` 安装包（未分卷的小包）；
- Gitee `releases/latest` 返回的 asset **没有 size 字段**，因此对每个附件发 `HEAD` 请求取 `Content-Length` 补全（下载进度条依赖它）。

### 2.2 下载与合并（`download-update`）

- 逐卷流式下载到系统临时目录，全程回报 `update-download-progress`（0-100，跨分卷累计）；
- 下载完按序拼接分卷为完整 exe（每卷合并后立即删除），最终文件名去掉 `.gpartNN` 后缀；
- `install-update`：Windows 上 `shell.openPath(finalPath)` 启动 NSIS 静默安装，成功后 `app.quit()`。

### 2.3 前端交互（设置页）

- 「检查更新」按钮 → 状态文案（已是最新 / 发现新版本 / 未上传安装包）；
- 「下载并安装」按钮 → 进度条（渐变青色）→ 100% 后自动拉起安装程序并退出应用。

## 3. 发布端：`auto_deploy/deploy.js`

### 3.1 执行流程（`npm run deploy`）

| 步骤 | 说明 |
|---|---|
| 1. 版本号 +1 | `package.json` 的 `version` patch 自增（`--minor` / `--major` / `--no-bump` 可选），dry-run 也会写回 |
| 2. Python 打包 | `npm run build-python`：PyInstaller onefile 打 `converter/converter.py` → `converter/dist/pdf-converter.exe`，并 `--exclude-module pandas scipy pyarrow matplotlib`（实际只需 pdfplumber + ezdxf + numpy，排除后 300MB → 49.8MB） |
| 3. Electron 打包 | `npm run dist`：electron-builder NSIS 安装包输出到 `release/` |
| 4. 分卷 | 单文件 > 90MB 自动切成 `Setup x.x.x.exe.gpart01/02...`（Gitee Release 单附件上限 100MB） |
| 5. 上传 | 先删 Release 里同名旧附件再传（支持重复发布），失败自动重试 3 次；Release 不存在则自动创建（tag = `v版本号`，标题 `v版本号 - PDF to CAD Converter`） |
| 6. 校验 | 重新拉 `releases/latest`，确认客户端视角能看到新版本 |

### 3.2 配置

`auto_deploy/deploy.config.json`（已被 .gitignore 排除，**不得提交**）：

```json
{
  "token": "<Gitee 私人令牌，需 projects 权限>",
  "owner": "hqxluoyang",
  "repo": "pdf_to_cad_pro_update"
}
```

### 3.3 标准发布命令

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/';
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/';
npm run deploy
```

两个镜像环境变量是**国内网络必需**的：GitHub 直连下载 Electron 运行时（111MB）和 winCodeSign 会长时间卡死，npmmirror 镜像约 1-2 分钟完成。

### 3.4 常用参数

```powershell
node auto_deploy/deploy.js --dry-run     # 全流程演练：不构建、不上传（会写版本号，跑完记得改回）
node auto_deploy/deploy.js --no-bump     # 不改版本号，重建并覆盖发布当前版本
node auto_deploy/deploy.js --minor       # 次版本号升级
```

## 4. 实测记录

- 2026-08-31：v1.0.2 发布成功，安装包 179.3MB 分为 2 卷（90MB + 89.3MB）上传；旧版客户端「检查更新 → 下载 → 合并 → 启动安装」链路全部打通。

## 5. 踩坑记录（重要）

1. **Gitee Release 单附件上限 100MB**：超限上传会直接失败（表现为 fetch 中断）。方案：发布端切 90MB 分卷、客户端下载后合并。分卷命名 `.gpartNN`，客户端靠正则 `/\.gpart\d+$/i` 识别并按名排序。
2. **不要把 pandas/scipy/pyarrow 打进 Python 包**：PyInstaller 全量依赖会膨胀到 300MB+；`converter.py` 实际依赖只有 pdfplumber、ezdxf、numpy（ezdxf 加速模块依赖 numpy，**不能排除**，否则运行报 `cydist` 错）。
3. **`releases/latest` 无 size 字段**：进度条会失效，必须 HEAD 补全。
4. **重复发布**：deploy.js 上传前会删除同名旧附件，所以同一 tag 可反复发布；`--no-bump` 用于只修构建产物的场景。
5. **国内网络**：GitHub 直连必卡，务必带 §3.3 的两个镜像变量。
6. **令牌安全**：token 只放 `deploy.config.json`（已 gitignore）；曾在聊天中泄露过的旧令牌应立即在 Gitee 后台吊销重建。

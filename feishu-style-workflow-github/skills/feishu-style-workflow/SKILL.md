---
name: feishu-style-workflow
description: 当用户需要把飞书多维表格里的 Midjourney 风格种子行图片，按字段一一对应下载源文件并上传到飞书收集表单时使用。适用于按序号准备确认截图、等待用户确认后提交、提交后复核结果总表截图、清理本地临时图片的完整流程。
---

# 飞书风格种子上传流程

## 使用场景

当用户给出飞书源表截图、源表序号，或要求“上传这些”“确定提交”“下载飞书图片并上传到表单”时，使用本 Skill。

核心原则：

- 只能使用飞书源表 API 下载到的原始附件文件。
- 不允许用截图、裁剪图、缩略图、浏览器预览图作为上传源文件。
- 用户没有明确说“确定提交”前，只能准备和展示确认截图，不能提交。
- 每次提交后必须复核结果总表，并给用户结果总表界面截图。
- 确认提交成功后，清理本地下载图片和临时确认文件。

## 固定配置

源表：

- URL: `https://my.feishu.cn/base/KMOAbNea0apS6WsPKtmcdfibnbe?table=tblFw0YDQZEJtFmS&view=vew9OolRq2`
- `app_token`: `KMOAbNea0apS6WsPKtmcdfibnbe`
- `table_id`: `tblFw0YDQZEJtFmS`
- `view_id`: `vew9OolRq2`

目标表单：

- URL: `https://merjic-ai.feishu.cn/share/base/form/shrcnjGhxDbVZuaxu2LR5Xix40d?iframeFrom=docx&ccm_open=iframe`

结果总表：

- URL: `https://merjic-ai.feishu.cn/base/PKf4bQCEaa6t38sXMmwcpwjinJs?table=tblNblsVDhI768On&view=vewckV2RX3`
- `app_token`: `PKf4bQCEaa6t38sXMmwcpwjinJs`
- `table_id`: `tblNblsVDhI768On`
- `view_id`: `vewckV2RX3`

固定填写：

- `种子挖掘者` = `沐柒Moki`

## 字段映射

源表字段到目标表单字段必须一一对应：

- `风格种子` -> `风格种子或p（每周上限10个）`
- `人` -> `person`
- `动物` -> `animal`
- `建筑` -> `architecture`
- `环境` -> `environment`
- 固定值 `沐柒Moki` -> `种子挖掘者`

用户说的“序号”是源表当前视图中的 1-based 行号，不是 record id。

## 凭据

运行前必须有飞书应用凭据：

```powershell
$env:FEISHU_APP_ID='cli_xxxxxxxxxxxxxxxxx'
$env:FEISHU_APP_SECRET='your_app_secret_here'
```

也可以在仓库根目录创建 `.env`：

```text
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret_here
```

不要把真实 `.env`、`app_secret`、access token、下载图片提交到 Git。

## 标准命令

在仓库根目录运行。

准备并生成提交前确认截图：

```powershell
node .\feishu_style_workflow.js prepare 12,13,15
```

用户确认后提交：

```powershell
node .\feishu_style_workflow.js submit 12,13,15
```

只复核结果总表，不提交：

```powershell
node .\feishu_style_workflow.js verify 3522807328,468206440
```

清理指定行本地临时文件：

```powershell
node .\feishu_style_workflow.js cleanup 12,13,15
```

## 工作流程

1. 收到用户给出的序号或截图后，识别需要处理的源表行号。
2. 如果截图里某个序号被遮挡，先用 API 按可见种子或上下文反查；不能确认时停止并说明，不要猜测提交。
3. 运行 `prepare <rows>`。
4. 检查脚本输出的源表确认截图和目标表单截图。
5. 对每一行做内部自检：
   - 行号正确。
   - 风格种子正确。
   - `人/动物/建筑/环境` 四列图片与目标 `person/animal/architecture/environment` 一一对应。
   - 目标表单里存在 `沐柒Moki`。
   - 下载文件字节数非零，并与 API metadata size 基本一致。
6. 把每行的两张截图发给用户：源表行截图 + 目标表单截图。
7. 等用户明确回复 `确定提交`。
8. 运行 `submit <same rows>`。
9. 提交后必须检查：
   - 表单页出现 `提交成功` / `继续开动`。
   - 页面没有 `必填` 错误。
   - 结果总表 API 能查到对应种子。
   - 结果总表中四张图片字段都存在。
   - `种子挖掘者` 是 `沐柒Moki`。
10. 等结果总表页面视觉稳定后截图，再发给用户。
11. 确认成功后清理本地临时图片和确认文件。

## 截图要求

提交前必须给用户看：

- 源表行截图。
- 已填好的目标表单截图。

提交后必须给用户看：

- 结果总表界面截图。

最后结果总表截图不要抢发。应等待页面文本出现、图片加载完成或画面稳定后再截图。

## 失败处理

遇到以下情况必须停止，不要提交：

- 源表某行缺少任一附件字段。
- 截图序号与 API 行号无法确认。
- 目标表单上传后显示占位符或缺图。
- 文本看似填入，但提交后仍显示 `必填`。
- 结果总表 API 查不到提交的种子。
- 结果总表中图片字段缺失。

如果提交失败，不要清理本地文件，先保留现场用于排查。

## 本地文件规则

运行产物默认在 `.feishu-work/`。

可清理：

- `.feishu-work/rows/<row>_<seed>/`
- `.feishu-work/confirm/row_<row>_*`
- 提交成功后的临时结果 JSON

不能清理：

- `feishu_style_workflow.js`
- `README.md`
- `.env.example`
- `.gitignore`
- `package.json`
- `package-lock.json`
- 用户自己的 `.env`

## GitHub 注意事项

上传到 GitHub 前确认：

- `.env` 已被 `.gitignore` 忽略。
- `.feishu-work/` 已被 `.gitignore` 忽略。
- `node_modules/` 已被 `.gitignore` 忽略。
- 没有真实 `FEISHU_APP_SECRET`。
- 建议仓库使用 private，因为脚本和文档包含飞书业务链接、app token、table id、view id。

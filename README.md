# Feishu Style Workflow

This workflow transfers original image attachments from a Feishu Bitable source row into the Merjic style mining Feishu form.

It is API-first for source images, so screenshots are never used as upload sources.

## Requirements

- Node.js 18+
- Google Chrome or Microsoft Edge installed
- Feishu app credentials with Bitable read and Drive file download permissions

Install dependencies:

```powershell
npm install
```

Set credentials in the current terminal:

```powershell
$env:FEISHU_APP_ID='cli_xxxxxxxxxxxxxxxxx'
$env:FEISHU_APP_SECRET='your_app_secret_here'
```

Or create a local `.env` file:

```powershell
Copy-Item .env.example .env
notepad .env
```

Do not commit real credentials. `.env` and `.feishu-work/` are ignored.

## Normal Workflow

Prepare rows and generate pre-submit screenshots:

```powershell
node .\feishu_style_workflow.js prepare 12,13,15
```

Review the generated screenshots under `.feishu-work\confirm\`.

After manual confirmation, submit those same rows:

```powershell
node .\feishu_style_workflow.js submit 12,13,15
```

The submit command:

- refills the target form
- submits only after you run the command
- checks the form success page
- verifies the submitted records in the result Bitable API
- waits for the result table page to visually stabilize before taking the final screenshot
- cleans row-local downloaded images and confirmation artifacts

Verify already-submitted seeds without submitting anything:

```powershell
node .\feishu_style_workflow.js verify 3522807328,468206440
```

Clean local row artifacts if needed:

```powershell
node .\feishu_style_workflow.js cleanup 12,13,15
```

## Field Mapping

Source Bitable:

- `风格种子` -> target `风格种子或p（每周上限10个）`
- `人` -> `person`
- `动物` -> `animal`
- `建筑` -> `architecture`
- `环境` -> `environment`

Target constant:

- `种子挖掘者` -> `沐柒Moki`

## Safety Rules

- Use source Bitable attachment files from the API only.
- Do not upload screenshots, crops, thumbnails, or browser-rendered images as source files.
- Always run `prepare` first and inspect the screenshots.
- Only run `submit` after confirmation.
- Keep credentials in environment variables, not in Git.

## Codex Skill

A Chinese Codex Skill prompt is included at:

```text
skills/feishu-style-workflow/SKILL.md
```

When using this workflow on another device, copy or install that Skill into Codex, then keep device-specific credentials in a local `.env`.

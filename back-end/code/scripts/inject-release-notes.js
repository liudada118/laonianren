/**
 * inject-release-notes.js
 * 
 * 打包后自动运行：读取 release-notes/{platform}/{version}.md，
 * 将内容注入 dist/ 下的 latest.yml / latest-mac.yml 的 releaseNotes 字段。
 * 
 * 用法：node scripts/inject-release-notes.js
 * 
 * electron-builder 生成的 latest.yml 格式为 YAML，
 * 本脚本在文件末尾追加 releaseNotes 字段（YAML block scalar 格式）。
 */

const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')
const version = pkg.version
const distDir = path.join(__dirname, '..', 'dist')

// 平台 → yml 文件名 → release-notes 子目录
const platformConfigs = [
  { ymlFile: 'latest.yml', noteDir: 'windows' },
  { ymlFile: 'latest-mac.yml', noteDir: 'mac' },
]

function run() {
  console.log(`[inject-release-notes] version: ${version}`)
  console.log(`[inject-release-notes] dist dir: ${distDir}`)

  let injected = 0

  for (const { ymlFile, noteDir } of platformConfigs) {
    const ymlPath = path.join(distDir, ymlFile)
    if (!fs.existsSync(ymlPath)) {
      console.log(`[inject-release-notes] ${ymlFile} not found, skipping`)
      continue
    }

    // 读取 release notes markdown
    const notePath = path.join(__dirname, '..', 'release-notes', noteDir, `${version}.md`)
    if (!fs.existsSync(notePath)) {
      console.warn(`[inject-release-notes] release note not found: ${notePath}`)
      continue
    }

    const noteContent = fs.readFileSync(notePath, 'utf-8').trim()
    if (!noteContent) {
      console.warn(`[inject-release-notes] release note is empty: ${notePath}`)
      continue
    }

    // 读取现有 yml
    let ymlContent = fs.readFileSync(ymlPath, 'utf-8')

    // 移除已有的 releaseNotes 字段（如果有）
    ymlContent = ymlContent.replace(/\nreleaseNotes:[\s\S]*?(?=\n[a-zA-Z]|\n$|$)/g, '')

    // 将 markdown 转为 YAML block scalar（使用 | 保留换行）
    const indentedNotes = noteContent
      .split('\n')
      .map(line => '  ' + line)
      .join('\n')

    // 追加 releaseNotes 字段
    ymlContent = ymlContent.trimEnd() + '\nreleaseNotes: |\n' + indentedNotes + '\n'

    fs.writeFileSync(ymlPath, ymlContent, 'utf-8')
    console.log(`[inject-release-notes] injected into ${ymlFile} (${noteContent.length} chars)`)
    injected++
  }

  if (injected === 0) {
    console.warn('[inject-release-notes] no yml files were updated')
  } else {
    console.log(`[inject-release-notes] done, ${injected} file(s) updated`)
  }
}

run()

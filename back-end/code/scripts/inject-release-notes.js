const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')
const version = pkg.version
const distDir = path.join(__dirname, '..', 'dist')

const platformConfigs = [
  {
    label: 'windows',
    ymlFile: 'latest.yml',
    noteDir: 'windows',
    detectsArtifact(name) {
      return name.endsWith('.exe')
    }
  },
  {
    label: 'mac',
    ymlFile: 'latest-mac.yml',
    noteDir: 'mac',
    detectsArtifact(name) {
      return name.endsWith('.dmg') || name.endsWith('.zip')
    }
  }
]

function detectTargetConfigs() {
  if (!fs.existsSync(distDir)) {
    return platformConfigs
  }

  const distEntries = fs.readdirSync(distDir).map(name => name.toLowerCase())
  const targets = platformConfigs.filter(({ ymlFile, detectsArtifact }) => (
    distEntries.includes(ymlFile.toLowerCase()) ||
    distEntries.some(entry => detectsArtifact(entry))
  ))

  return targets.length > 0 ? targets : platformConfigs
}

function loadReleaseNotes(noteDir) {
  const notePath = path.join(__dirname, '..', 'release-notes', noteDir, `${version}.md`)
  if (!fs.existsSync(notePath)) {
    console.warn(`[inject-release-notes] release note not found: ${notePath}`)
    return null
  }

  const noteContent = fs.readFileSync(notePath, 'utf-8').trim()
  if (!noteContent) {
    console.warn(`[inject-release-notes] release note is empty: ${notePath}`)
    return null
  }

  return noteContent
}

function injectReleaseNotes(ymlPath, noteContent) {
  const indentedNotes = noteContent
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')

  let ymlContent = fs.readFileSync(ymlPath, 'utf-8')
  ymlContent = ymlContent.replace(/\nreleaseNotes:[\s\S]*?(?=\n[a-zA-Z]|\n$|$)/g, '')
  ymlContent = `${ymlContent.trimEnd()}\nreleaseNotes: |\n${indentedNotes}\n`
  fs.writeFileSync(ymlPath, ymlContent, 'utf-8')
}

function run() {
  console.log(`[inject-release-notes] version: ${version}`)
  console.log(`[inject-release-notes] dist dir: ${distDir}`)

  const targetConfigs = detectTargetConfigs()
  console.log(`[inject-release-notes] detected targets: ${targetConfigs.map(({ label }) => label).join(', ')}`)

  let injected = 0

  for (const { label, ymlFile, noteDir } of targetConfigs) {
    const ymlPath = path.join(distDir, ymlFile)
    if (!fs.existsSync(ymlPath)) {
      console.warn(
        `[inject-release-notes] ${ymlFile} not found for ${label}; ` +
        'electron-builder must generate update metadata before release notes can be injected'
      )
      continue
    }

    const noteContent = loadReleaseNotes(noteDir)
    if (!noteContent) {
      continue
    }

    injectReleaseNotes(ymlPath, noteContent)
    console.log(`[inject-release-notes] injected into ${ymlFile} (${noteContent.length} chars)`)
    injected++
  }

  if (injected === 0) {
    console.warn('[inject-release-notes] no yml files were updated')
    return
  }

  console.log(`[inject-release-notes] done, ${injected} file(s) updated`)
}

run()

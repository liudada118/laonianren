const { execFileSync } = require('child_process')

function hasAll(keys) {
  return keys.every((key) => Boolean(process.env[key]))
}

function fail(message) {
  console.error(`[mac-release] ${message}`)
  process.exit(1)
}

try {
  execFileSync('xcrun', ['--find', 'notarytool'], { stdio: 'ignore' })
} catch {
  fail('未找到 notarytool。请先安装 Xcode Command Line Tools。')
}

const hasApiKeyAuth = hasAll(['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'])
const hasAppleIdAuth = hasAll(['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'])
const hasKeychainProfileAuth = hasAll(['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'])

if (!hasApiKeyAuth && !hasAppleIdAuth && !hasKeychainProfileAuth) {
  fail(
    '缺少 notarization 凭据。请提供 APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER，' +
      '或 APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID，' +
      '或 APPLE_KEYCHAIN + APPLE_KEYCHAIN_PROFILE。'
  )
}

if (
  process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' &&
  !process.env.CSC_LINK &&
  !process.env.CSC_NAME
) {
  fail('已禁用自动发现签名证书，但未提供 CSC_LINK 或 CSC_NAME。')
}

console.log('[mac-release] notarization 凭据检查通过')
console.log('[mac-release] 请确认本机钥匙串中已安装 Developer ID Application 证书，或已提供 CSC_LINK/CSC_NAME')

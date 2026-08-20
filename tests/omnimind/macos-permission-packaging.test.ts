import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

describe('macOS permission packaging', () => {
  it('declares the scoped Apple Events purpose and automation entitlement', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))
    const plist = fs.readFileSync(path.resolve('electron/entitlements.mac.plist'), 'utf8')

    expect(packageJson.build.mac.extendInfo.NSAppleEventsUsageDescription).toBe(
      '仅当你启用 OmniMind 自动托管时，OmniMindWeChat 才会通过“系统事件”使用 Apple Events，以辅助完成你确认的自动回复操作。'
    )
    expect(plist).toContain('<key>com.apple.security.automation.apple-events</key>')
    expect(plist).toMatch(/<key>com\.apple\.security\.automation\.apple-events<\/key>\s*<true\/>/)
  })
})

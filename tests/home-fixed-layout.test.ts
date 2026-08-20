import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('OmniMindWeChat 首页固定三区布局合同', () => {
  it('uses the unified fixed page container without a private hero or scrolling shell', () => {
    const page = read('../src/pages/HomePage.tsx')
    const app = read('../src/App.tsx')
    const workbench = read('../src/features/home/HomeWorkbench.tsx')
    const styles = read('../src/pages/HomePage.scss')

    expect(page).toContain('<AppPageContainer className="home-page" scrollable={false}>')
    expect(page).not.toContain('title=')
    expect(page).not.toContain('subtitle=')
    expect(app).toMatch(/usesNativeDetailContainer[^\n]*routeLocation\.pathname\s*===\s*['"]\/home['"]/)
    expect(workbench).not.toContain('home-workbench-hero')
    expect(workbench).not.toContain('home-summary-grid')
    expect(styles).not.toMatch(/\.home-workbench\s*\{[^}]*max-width:/s)
    expect(styles).toMatch(/\.home-workbench\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s)
  })

  it('keeps scene, three operation modules, and a non-collapsible queue in fixed grid areas', () => {
    const workbench = read('../src/features/home/HomeWorkbench.tsx')
    const operations = read('../src/features/home/HomeOperationsPanel.tsx')
    const queue = read('../src/features/home/HomeQueuePanel.tsx')
    const styles = read('../src/pages/HomePage.scss')

    expect(workbench).toContain('<DollOfficeScene roles={roles} />')
    expect(workbench).toContain('<HomeOperationsPanel')
    expect(workbench).toContain('<HomeQueuePanel')
    expect(operations).toContain('home-data-module')
    expect(operations).toContain('home-ai-module')
    expect(operations).toContain('home-extension-module')
    expect(queue).not.toMatch(/onClose=|aria-label=["']关闭|aria-expanded=|data-collapsed=/)
    expect(styles).toContain("'scene queue'")
    expect(styles).toContain("'operations queue'")
    expect(styles).toMatch(/grid-template-columns:\s*minmax\(0,\s*2\.4fr\)\s*minmax\(260px,\s*1fr\)/)
    expect(styles).toMatch(/\.home-queue-scroll\s*\{[^}]*overflow:\s*auto/s)
  })

  it('preserves useful widths at all native detail sizes and only stacks below desktop support', () => {
    const styles = read('../src/pages/HomePage.scss')
    const nativeDetailWidths = [1037, 1209, 857, 1029]

    // 固定桌面公式来自生产 CSS：左右 12px 内边距、12px gap、右栏至少 260px。
    // 最小 857px 内容区仍给左侧 521px，足以容纳三个紧凑模块；其它尺寸只会更宽。
    nativeDetailWidths.forEach((width) => expect(width - 24 - 12 - 260).toBeGreaterThanOrEqual(521))
    expect(styles).toContain('grid-template-columns: 260px 260px minmax(0, 1fr)')
    expect(styles).toContain('@media (max-width: 620px)')
    expect(styles).toContain("grid-template-areas: 'scene' 'operations' 'queue'")
  })

  it('uses the compact desktop-front role plate instead of the old floating status card', () => {
    const scene = read('../src/features/home/DollOfficeScene.tsx')
    const styles = read('../src/pages/HomePage.scss')

    expect(scene).toContain('<span aria-hidden="true">{role.order}</span><strong>{role.title}</strong>')
    expect(scene).not.toContain('<small>{role.status}</small>')
    expect(styles).toContain('var(--office-nameplate-width-percent)')
    expect(styles).toContain('var(--office-nameplate-translate-y)')
    expect(styles).not.toMatch(/\.home-office-label\s*\{[^}]*backdrop-filter:/s)
    expect(styles).not.toMatch(/\.home-office-label\s*\{[^}]*margin-top:/s)
    expect(styles).not.toMatch(/\.home-office-label\s*\{[^}]*translate\(-50%,\s*-100%\)/s)
  })
})

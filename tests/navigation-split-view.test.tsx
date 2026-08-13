// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, useState } from 'react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TitleBar from '../src/components/TitleBar'
import Sidebar from '../src/components/Sidebar'
import { WeFlowPageContainer } from '../src/components/common/WeFlowPageContainer'
import { DetailChromeProvider } from '../src/components/common/DetailChromeContext'
import { useAppStore } from '../src/stores/appStore'
import ChatHeader from '../src/pages/Chat/ChatHeader'

afterEach(cleanup)

const installSidebarElectronApi = (): void => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      auth: { verifyEnabled: async () => false },
      config: { get: async () => null },
      chat: { getContact: async () => null, getMyAvatarUrl: async () => null }
    }
  })
}

const SidebarLocationProbe = () => {
  const location = useLocation()
  const state = location.state as {
    initialTab?: string
    backgroundLocation?: { pathname?: string }
  } | null
  return (
    <output data-testid="sidebar-location">
      {location.pathname}|{state?.initialTab || ''}|{state?.backgroundLocation?.pathname || ''}
    </output>
  )
}

describe('NavigationSplitView history controls', () => {
  it('keeps unavailable page history controls visible but disabled', () => {
    render(
      <MemoryRouter>
        <WeFlowPageContainer title="详情" showNavigationStack>
          内容
        </WeFlowPageContainer>
      </MemoryRouter>
    )

    expect((screen.getByRole('button', { name: '返回' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '前进' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('runs custom page history handlers only when their direction is available', () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    render(
      <MemoryRouter>
        <WeFlowPageContainer
          title="详情"
          showNavigationStack
          onBack={onBack}
          onForward={onForward}
          canGoBack={false}
          canGoForward
        />
      </MemoryRouter>
    )

    const back = screen.getByRole('button', { name: '返回' })
    const forward = screen.getByRole('button', { name: '前进' })
    expect((back as HTMLButtonElement).disabled).toBe(true)
    expect((forward as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(back)
    fireEvent.click(forward)
    expect(onBack).not.toHaveBeenCalled()
    expect(onForward).toHaveBeenCalledOnce()
  })

  it('gives the global toolbar real disabled state and custom handler semantics', () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    render(
      <MemoryRouter>
        <TitleBar
          showWindowControls={false}
          showNavControls
          onBack={onBack}
          onForward={onForward}
          canGoBack
          canGoForward={false}
        />
      </MemoryRouter>
    )

    const back = screen.getByRole('button', { name: '后退' })
    const forward = screen.getByRole('button', { name: '前进' })
    expect((back as HTMLButtonElement).disabled).toBe(false)
    expect((forward as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(back)
    fireEvent.click(forward)
    expect(onBack).toHaveBeenCalledOnce()
    expect(onForward).not.toHaveBeenCalled()
  })

  it('keeps independent-window defaults compatible: logo visible and history hidden', () => {
    const { container } = render(
      <MemoryRouter>
        <TitleBar showWindowControls={false} />
      </MemoryRouter>
    )

    expect(container.querySelector('.title-logo')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '后退' })).toBeNull()
    expect(screen.queryByRole('button', { name: '前进' })).toBeNull()
  })
})

describe('WeFlowPageContainer native detail states', () => {
  it('supports canonical loading and empty props with accessible status semantics', () => {
    const { rerender } = render(
      <MemoryRouter>
        <WeFlowPageContainer loading loadingText="正在载入" />
      </MemoryRouter>
    )

    expect(screen.getByRole('status').textContent).toContain('正在载入')

    rerender(
      <MemoryRouter>
        <WeFlowPageContainer
          empty
          emptyTitle="没有结果"
          emptyDescription="调整条件后重试"
          emptyAction={<button type="button">重试</button>}
        />
      </MemoryRouter>
    )

    expect(screen.getByRole('status').textContent).toContain('没有结果')
    expect(screen.getByText('调整条件后重试')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('renders footer actions in the bottom safe-area inset', () => {
    const { container } = render(
      <MemoryRouter>
        <WeFlowPageContainer footerActions={<button type="button">保存</button>} />
      </MemoryRouter>
    )

    expect(container.querySelector('.safe-area-bottom-inset')?.contains(
      screen.getByRole('button', { name: '保存' })
    )).toBe(true)
  })

  it('lets canonical false override legacy loading and empty flags', () => {
    render(
      <MemoryRouter>
        <WeFlowPageContainer loading={false} isLoading empty={false} isEmpty>
          已加载内容
        </WeFlowPageContainer>
      </MemoryRouter>
    )

    expect(screen.getByText('已加载内容')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('Detail chrome declaration bridge', () => {
  it('renders canonical page chrome once in the unified toolbar without a local header', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/backup']}>
        <DetailChromeProvider>
          <TitleBar showLogo={false} showWindowControls={false} />
          <WeFlowPageContainer
            title="声明标题"
            subtitle="声明副标题"
            headerActions={<button type="button">统一操作</button>}
          >
            页面内容
          </WeFlowPageContainer>
        </DetailChromeProvider>
      </MemoryRouter>
    )

    expect(screen.getAllByText('声明标题')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '统一操作' })).toHaveLength(1)
    expect(container.querySelector('.title-bar')?.textContent).toContain('声明副标题')
    expect(container.querySelector('.weflow-page-header')).toBeNull()
  })

  it('cleans legacy chrome declarations on unmount and restores the route fallback', () => {
    const Harness = () => {
      const [showDetail, setShowDetail] = useState(true)
      return (
        <DetailChromeProvider>
          <button type="button" onClick={() => setShowDetail(false)}>切换页面</button>
          <TitleBar showLogo={false} showWindowControls={false} />
          {showDetail
            ? (
                <WeFlowPageContainer
                  title="旧接口标题"
                  description="旧接口副标题"
                  actions={<button type="button">旧接口操作</button>}
                />
              )
            : <div>未迁移页面</div>}
        </DetailChromeProvider>
      )
    }

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Harness />
      </MemoryRouter>
    )

    expect(screen.getAllByText('旧接口标题')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '旧接口操作' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切换页面' }))
    expect(screen.queryByText('旧接口标题')).toBeNull()
    expect(screen.queryByRole('button', { name: '旧接口操作' })).toBeNull()
    expect(screen.getByText('首页')).toBeTruthy()
  })
})

describe('Sidebar account menu accessibility', () => {
  it('removes hidden items from Tab order and closes an open menu with Escape', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        auth: { verifyEnabled: async () => false },
        config: { get: async () => null },
        chat: { getContact: async () => null, getMyAvatarUrl: async () => null }
      }
    })
    const { container } = render(
      <MemoryRouter>
        <Sidebar collapsed={false} />
      </MemoryRouter>
    )

    const trigger = container.querySelector('.sidebar-user-card') as HTMLElement
    const menuItems = screen.getAllByRole('menuitem', { hidden: true }) as HTMLButtonElement[]
    expect(menuItems.every((item) => item.tabIndex === -1)).toBe(true)

    fireEvent.click(trigger)
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'))
    expect(menuItems.every((item) => item.tabIndex === 0)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
    expect(menuItems.every((item) => item.tabIndex === -1)).toBe(true)
  })
})

describe('R5 sidebar database status contract', () => {
  it('replaces navigation search with a basename-only connected database button', () => {
    installSidebarElectronApi()
    useAppStore.setState({
      isDbConnected: true,
      dbPath: '/Users/example/Library/Application Support/WeFlow/account.db'
    })

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Sidebar collapsed={false} />
      </MemoryRouter>
    )

    expect(screen.queryByRole('textbox', { name: '搜索' })).toBeNull()
    const databaseButton = screen.getByRole('button', { name: '微信已绑定：account.db' })
    expect(databaseButton.getAttribute('title')).toBe('微信已绑定：account.db')
    expect(databaseButton.textContent).toContain('微信已绑定')
    expect(databaseButton.textContent).toContain('account.db')
    expect(databaseButton.textContent).not.toContain('/Users/example')
  })

  it('shows disconnected recovery text and opens the database settings tab with background location', () => {
    installSidebarElectronApi()
    useAppStore.setState({ isDbConnected: false, dbPath: null })

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Sidebar collapsed={false} />
        <SidebarLocationProbe />
      </MemoryRouter>
    )

    const databaseButton = screen.getByRole('button', { name: '微信未绑定，点击配置' })
    expect(databaseButton.textContent).toContain('微信未绑定')
    expect(databaseButton.textContent).toContain('点击配置')
    fireEvent.click(databaseButton)
    expect(screen.getByTestId('sidebar-location').textContent).toBe('/settings|database|/chat')
  })

  it('uses basename-only semantics and a 40px control in collapsed mode', () => {
    installSidebarElectronApi()
    useAppStore.setState({
      isDbConnected: true,
      dbPath: 'C:\\Users\\example\\WeChat\\message.db'
    })

    const { container } = render(
      <MemoryRouter>
        <Sidebar collapsed />
      </MemoryRouter>
    )

    const databaseButton = screen.getByRole('button', { name: '微信已绑定：message.db' })
    expect(databaseButton.getAttribute('title')).toBe('微信已绑定：message.db')
    expect(databaseButton.textContent).not.toContain('C:\\Users\\example')
    expect(databaseButton.classList.contains('sidebar-database-status')).toBe(true)
    expect(container.querySelector('.sidebar-database-copy')).toBeNull()
  })

  it('defines the approved 40px status card, 8px nav radius, and one static separator without a detail shadow', () => {
    const sidebar = readFileSync(resolve(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8')
    const sidebarStyles = readFileSync(resolve(process.cwd(), 'src/components/Sidebar.scss'), 'utf8')
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const appStyles = readFileSync(resolve(process.cwd(), 'src/App.scss'), 'utf8')

    expect(sidebar).not.toContain('sidebar-search-pill')
    expect(sidebar).not.toContain('searchQuery')
    expect(sidebarStyles).not.toContain('.sidebar-search-pill')
    expect(sidebarStyles).toMatch(/\.sidebar-database-status\s*\{[^}]*height:\s*40px/s)
    expect(sidebarStyles).toMatch(/\.sidebar-database-status\s*\{[^}]*border-radius:\s*8px/s)
    expect(sidebarStyles).toMatch(/\.nav-item\s*\{[^}]*border-radius:\s*8px/s)
    expect(sidebarStyles).not.toMatch(/\.nav-item\s*\{[^}]*border-radius:\s*999px/s)
    expect(app.match(/sidebar-detail-separator/g)).toHaveLength(1)
    expect(appStyles.match(/\.sidebar-detail-separator/g)).toHaveLength(1)
    expect(appStyles).not.toMatch(/\.content\s*\{[^}]*box-shadow:/s)
    expect(appStyles).not.toMatch(/\[data-mode="dark"\]\s+\.content\s*\{[^}]*box-shadow:/s)
  })
})

describe('R4 static shell contract', () => {
  it('renders sidebar toggle before the grouped history capsule', () => {
    const { container } = render(<MemoryRouter><TitleBar showWindowControls={false} showNavControls onToggleSidebar={() => undefined} /></MemoryRouter>)
    const left = container.querySelector('.title-bar-left') as HTMLElement
    const toggle = screen.getByRole('button', { name: '收起侧边栏' })
    const history = container.querySelector('.title-nav-history') as HTMLElement
    expect(Array.from(left.children).indexOf(toggle)).toBeLessThan(Array.from(left.children).indexOf(history))
    expect(history.querySelectorAll('button')).toHaveLength(2)
    expect(history.querySelector('.title-nav-divider')).toBeNull()
  })

  it('defines noninteractive separator and fixed R4 dimensions', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const appStyles = readFileSync(resolve(process.cwd(), 'src/App.scss'), 'utf8')
    const titleStyles = readFileSync(resolve(process.cwd(), 'src/components/TitleBar.scss'), 'utf8')
    expect(app).toContain('sidebar-detail-separator')
    expect(app).not.toContain('SplitViewDivider')
    expect(app).not.toContain('sidebarWidth')
    expect(appStyles).toContain('.sidebar-detail-separator')
    expect(appStyles).toContain('pointer-events: none')
    expect(titleStyles).toContain('height: 52px')
    expect(titleStyles).toContain('width: 36px')
    expect(titleStyles).toContain('width: 72px')
    expect(titleStyles).toContain('border-radius: 18px')
    expect(titleStyles).toContain('margin-left: 14px')
  })
})

describe('NavigationSplitView static layout contract', () => {
  it('preserves legacy page framing while removing it for the migrated native detail route', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/App.scss'), 'utf8')

    expect(app).toContain("routeLocation.pathname === '/backup'")
    expect(app).toContain("'native-detail-container'")
    expect(styles).toMatch(/\.content\.native-detail-container\s*\{[^}]*overflow:\s*hidden/s)
    expect(styles).toMatch(/\.content\.native-detail-container\s*\{[^}]*padding:\s*0/s)
    expect(styles).toMatch(/\.content\.native-detail-container\s*\{[^}]*border-radius:\s*0/s)
    expect(styles).toMatch(/\.content\.native-detail-container\s*\{[^}]*box-shadow:\s*none/s)
    expect(styles).toMatch(/\.content\.native-detail-container\s*\{[^}]*background:\s*var\(--bg-primary\)/s)
  })

  it('keeps the toolbar in detail while sidebar and divider span the full split height', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'src/App.scss'), 'utf8')
    const splitIndex = app.indexOf('<div className="mac-split-view-container main-layout">')
    const sidebarIndex = app.indexOf('<Sidebar', splitIndex)
    const separatorIndex = app.indexOf('sidebar-detail-separator', sidebarIndex)
    const detailIndex = app.indexOf('<div className="detail-pane">', separatorIndex)
    const toolbarIndex = app.indexOf('<TitleBar', detailIndex)
    const contentIndex = app.indexOf('<main className=', toolbarIndex)

    expect(splitIndex).toBeGreaterThan(0)
    expect(sidebarIndex).toBeGreaterThan(splitIndex)
    expect(separatorIndex).toBeGreaterThan(sidebarIndex)
    expect(detailIndex).toBeGreaterThan(separatorIndex)
    expect(toolbarIndex).toBeGreaterThan(detailIndex)
    expect(contentIndex).toBeGreaterThan(toolbarIndex)
    expect(app).not.toContain('className="window-drag-region"')
    expect(styles).not.toContain('.window-drag-region')
    expect(app).toContain('showLogo={false}')
    expect(app).toContain('showNavControls')
    expect(app).toContain('showWindowControls')
    expect(app).not.toContain('showWindowControls={!isMacOS}')
    expect(app).not.toContain("isMacOS ? 'platform-macos' : 'platform-non-macos'")
    expect(app).toContain('<DetailChromeProvider>')
  })

  it('uses one frameless main-window contract without changing independent-window defaults', () => {
    const main = readFileSync(resolve(process.cwd(), 'electron/main.ts'), 'utf8')
    const mainWindowOptions = main.slice(main.indexOf('const win = new BrowserWindow({', main.indexOf('function createWindow')), main.indexOf('setupCustomTitleBarWindow(win', main.indexOf('function createWindow')))

    expect(mainWindowOptions).toMatch(/frame:\s*false/)
    expect(mainWindowOptions).not.toContain("titleBarStyle: 'hiddenInset'")
    expect(mainWindowOptions).not.toContain('trafficLightPosition:')
    expect(mainWindowOptions).not.toContain("process.platform === 'darwin'")
    expect(main).toContain('setupCustomTitleBarWindow(win)')
    expect(main).toMatch(/hideMacWindowButtons\s*=\s*true/)
  })

  it('maps the touched application surfaces to semantic layers without a macOS sidebar offset', () => {
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/main.scss'), 'utf8')
    const titleBarStyles = readFileSync(resolve(process.cwd(), 'src/components/TitleBar.scss'), 'utf8')
    const sidebarStyles = readFileSync(resolve(process.cwd(), 'src/components/Sidebar.scss'), 'utf8')
    const settingsStyles = readFileSync(resolve(process.cwd(), 'src/pages/SettingsPage.scss'), 'utf8')
    const dialogStyles = readFileSync(resolve(process.cwd(), 'src/components/common/WeFlowDialog.scss'), 'utf8')
    const closeDialogStyles = readFileSync(resolve(process.cwd(), 'src/components/WindowCloseDialog.scss'), 'utf8')

    expect(tokens).toContain('--layer-shell: 1000')
    expect(tokens).toContain('--layer-popover: 2000')
    expect(tokens).toContain('--layer-modal: 3000')
    expect(tokens).toContain('--layer-critical: 4000')
    expect(titleBarStyles).toContain('z-index: var(--layer-shell)')
    expect(settingsStyles).toContain('z-index: var(--layer-modal)')
    expect(dialogStyles).toContain('z-index: var(--layer-modal)')
    expect(closeDialogStyles).toContain('z-index: var(--layer-critical)')
    expect(sidebarStyles).not.toContain('.platform-macos .sidebar')
  })

  it('keeps sidebar width, selection, theme-token, and keyboard-focus contracts', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/components/Sidebar.scss'), 'utf8')
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/main.scss'), 'utf8')
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

    expect(styles).toMatch(/\.sidebar\s*\{[^}]*width:\s*240px/s)
    expect(styles).toMatch(/\.sidebar\s*\{[^}]*min-width:\s*240px/s)
    expect(styles).toMatch(/\.sidebar\s*\{[^}]*max-width:\s*240px/s)
    expect(styles).toMatch(/&\.collapsed\s*\{[^}]*width:\s*68px/s)
    expect(styles).toMatch(/&\.active\s*\{[^}]*background:\s*var\(--primary\)/s)
    expect(styles).toMatch(/&\.active\s*\{[^}]*border-radius:\s*8px/s)
    expect(styles).toContain('&:focus-visible')
    expect(app).toContain('<Sidebar collapsed={sidebarCollapsed} />')
    expect(app).toContain('<div className="sidebar-detail-separator" aria-hidden="true" />')
  })
})

describe('R6 compact Chat workbench contract', () => {
  const renderCompactChatHeader = () => {
    const onExportCurrentSession = vi.fn()
    const rendered = render(<ChatHeader
    session={{ username: 'alice', displayName: 'Alice', type: 1, unreadCount: 0, summary: '', sortTimestamp: 0, lastTimestamp: 0, lastMsgType: 1 }}
    isGroupChat={false}
    standaloneSessionWindow={false}
    showGroupMembersPanel={false}
    showGroupSummaryPanel={false}
    showJumpPopover={false}
    showInSessionSearch={false}
    showDetailPanel={false}
    aiGroupSummaryEnabled={false}
    shouldHideStandaloneDetailButton={false}
    isPrivateSnsSupported={false}
    isExportActionBusy={false}
    isCurrentSessionExporting={false}
    isPreparingExportDialog={false}
    isBatchTranscribing={false}
    isBatchDecrypting={false}
    isTriggeringSessionInsight={false}
    isRefreshingMessages={false}
    isLoadingMessages={false}
    currentSessionId="alice"
    compactHeader
    jumpCalendarWrapRef={createRef<HTMLDivElement>()}
    onTriggerSessionInsight={vi.fn()}
    onToggleGroupSummaryPanel={vi.fn()}
    onGroupAnalytics={vi.fn()}
    onToggleGroupMembersPanel={vi.fn()}
    onExportCurrentSession={onExportCurrentSession}
    onOpenSnsTimeline={vi.fn()}
    onBatchTranscribe={vi.fn()}
    onBatchDecrypt={vi.fn()}
    onToggleJumpPopover={vi.fn()}
    onToggleInSessionSearch={vi.fn()}
    onRefreshMessages={vi.fn()}
    onToggleDetailPanel={vi.fn()}
    />)
    return { ...rendered, onExportCurrentSession }
  }

  it('keeps secondary actions reachable in an accessible Escape-closing overflow menu', () => {
    renderCompactChatHeader()
    const more = screen.getByRole('button', { name: '更多会话操作' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-controls')).toBe('chat-header-more-menu')

    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menuitem', { name: '立即触发当前聊天 AI 见解' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '导出当前会话' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '批量语音处理' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '批量解密图片' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '刷新消息' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '会话详情' })).toBeTruthy()
    for (const name of ['立即触发当前聊天 AI 见解', '导出当前会话', '批量语音处理', '批量解密图片', '刷新消息', '会话详情']) {
      expect(screen.getAllByRole('menuitem', { name })).toHaveLength(1)
    }

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(more)
  })

  it('returns focus to More after an overflow command executes', async () => {
    const { onExportCurrentSession } = renderCompactChatHeader()
    const more = screen.getByRole('button', { name: '更多会话操作' })
    fireEvent.click(more)
    const insightItem = screen.getByRole('menuitem', { name: '立即触发当前聊天 AI 见解' })
    const exportItem = screen.getByRole('menuitem', { name: '导出当前会话' })
    await waitFor(() => expect(document.activeElement).toBe(insightItem))

    fireEvent.click(exportItem)

    expect(onExportCurrentSession).toHaveBeenCalledOnce()
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(more)
  })

  it('styles the compact overflow as an anchored vertical token-owned menu and supports arrow navigation', async () => {
    renderCompactChatHeader()
    const more = screen.getByRole('button', { name: '更多会话操作' })
    fireEvent.click(more)
    const items = screen.getAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'End' })
    expect(document.activeElement).toBe(items.at(-1))

    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')
    expect(styles).toMatch(/\.chat-header-more-wrap\s*\{[^}]*position:\s*relative/s)
    expect(styles).toMatch(/\.chat-header-more-menu\s*\{[^}]*position:\s*absolute[^}]*right:\s*0[^}]*z-index:[^}]*display:\s*(?:flex|grid)/s)
    expect(styles).toMatch(/\.chat-header-more-menu[^}]*border:\s*1px solid var\(--border-color\)[^}]*background:\s*var\(--(?:card-bg|bg-secondary)\)/s)
    expect(styles).toMatch(/\.chat-header-more-menu[^]*?>\s*button\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px[^}]*text-align:\s*left/s)
    expect(styles).toMatch(/\.chat-header-more-menu[^]*?&:focus-visible\s*\{[^}]*outline:/s)
  })

  it('renders the six ordinary desktop actions once and in production order', () => {
    const props = renderCompactChatHeader()
    props.rerender(<ChatHeader
      session={{ username: 'alice', displayName: 'Alice', type: 1, unreadCount: 0, summary: '', sortTimestamp: 0, lastTimestamp: 0, lastMsgType: 1 }}
      isGroupChat={false} standaloneSessionWindow={false} showGroupMembersPanel={false} showGroupSummaryPanel={false}
      showJumpPopover={false} showInSessionSearch={false} showDetailPanel={false} aiGroupSummaryEnabled={false}
      shouldHideStandaloneDetailButton={false} isPrivateSnsSupported={false} isExportActionBusy={false}
      isCurrentSessionExporting={false} isPreparingExportDialog={false} isBatchTranscribing={false}
      isBatchDecrypting={false} isTriggeringSessionInsight={false} isRefreshingMessages={false}
      isLoadingMessages={false} currentSessionId="alice" compactHeader={false} jumpCalendarWrapRef={createRef<HTMLDivElement>()}
      onTriggerSessionInsight={vi.fn()} onToggleGroupSummaryPanel={vi.fn()} onGroupAnalytics={vi.fn()}
      onToggleGroupMembersPanel={vi.fn()} onExportCurrentSession={vi.fn()} onOpenSnsTimeline={vi.fn()}
      onBatchTranscribe={vi.fn()} onBatchDecrypt={vi.fn()} onToggleJumpPopover={vi.fn()}
      onToggleInSessionSearch={vi.fn()} onRefreshMessages={vi.fn()} onToggleDetailPanel={vi.fn()}
    />)
    const labels = Array.from(props.container.querySelectorAll('.header-actions button')).map((button) => button.getAttribute('aria-label'))
    expect(labels).toEqual(['立即触发当前聊天 AI 见解', '导出当前会话', '批量语音处理', '批量解密图片', '刷新消息', '会话详情'])
    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')
    expect(styles).toMatch(/\.message-header[^]*?\.header-actions\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*nowrap[^}]*white-space:\s*nowrap/s)
    expect(styles).toMatch(/\.message-header[^]*?\.header-action-group\s*\{[^}]*display:\s*(?:inline-)?flex[^}]*align-items:\s*center[^}]*gap:\s*2px/s)
  })

  it('keeps all six middle-header actions at the approved 44px target with token-owned states', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')
    const modernStyles = styles.slice(styles.indexOf('// Modern chat surface overrides'))
    const messageHeaderStart = modernStyles.indexOf('\n.message-header {')
    const finalMessageHeader = modernStyles.slice(messageHeaderStart, modernStyles.indexOf('\n.message-content-wrapper', messageHeaderStart))

    expect(finalMessageHeader).toMatch(/\.icon-btn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
    expect(finalMessageHeader).toMatch(/\.icon-btn[^]*?&:focus-visible\s*\{[^}]*outline:\s*3px\s+solid\s+var\(--primary\)/s)
    expect(finalMessageHeader).toMatch(/\.icon-btn[^]*?&\.active\s*\{[^}]*background:\s*var\(--primary-light\)[^}]*color:\s*var\(--primary\)/s)
    expect(modernStyles).not.toMatch(/@media \(max-width:\s*720px\)[^]*?\.message-header[^]*?\.icon-btn\s*\{[^}]*(?:width|height):\s*(?:32|34)px/s)
  })

  it('integrates Calendar and Search into TitleBar as 44px mutually-exclusive actions', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    const titleStyles = readFileSync(resolve(process.cwd(), 'src/components/TitleBar.scss'), 'utf8')
    expect(chatPage).toMatch(/handleToggleJumpPopover[\s\S]*setShowInSessionSearch\(false\)/)
    expect(chatPage).toMatch(/handleToggleInSessionSearch[\s\S]*setShowJumpPopover\(false\)/)
    expect(titleStyles).toMatch(/\.title-detail-actions[^]*?\.icon-btn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
    expect(titleStyles).toMatch(/\.title-detail-actions[^]*?\.icon-btn:focus-visible[^}]*outline:\s*3px/s)
  })

  it('exposes live expanded state and stable panel relationships for the two TitleBar actions', async () => {
    const Harness = () => {
      const [calendarOpen, setCalendarOpen] = useState(false)
      const [searchOpen, setSearchOpen] = useState(false)
      return (
        <DetailChromeProvider>
          <TitleBar showLogo={false} showWindowControls={false} />
          <ChatHeader
            session={{ username: 'alice', displayName: 'Alice', type: 1, unreadCount: 0, summary: '', sortTimestamp: 0, lastTimestamp: 0, lastMsgType: 1 }}
            isGroupChat={false} standaloneSessionWindow={false} showGroupMembersPanel={false} showGroupSummaryPanel={false}
            showJumpPopover={calendarOpen} showInSessionSearch={searchOpen} showDetailPanel={false} aiGroupSummaryEnabled={false}
            shouldHideStandaloneDetailButton={false} isPrivateSnsSupported={false} isExportActionBusy={false}
            isCurrentSessionExporting={false} isPreparingExportDialog={false} isBatchTranscribing={false}
            isBatchDecrypting={false} isTriggeringSessionInsight={false} isRefreshingMessages={false}
            isLoadingMessages={false} currentSessionId="alice" compactHeader={false} jumpCalendarWrapRef={createRef<HTMLDivElement>()}
            onTriggerSessionInsight={vi.fn()} onToggleGroupSummaryPanel={vi.fn()} onGroupAnalytics={vi.fn()}
            onToggleGroupMembersPanel={vi.fn()} onExportCurrentSession={vi.fn()} onOpenSnsTimeline={vi.fn()}
            onBatchTranscribe={vi.fn()} onBatchDecrypt={vi.fn()}
            onToggleJumpPopover={() => { setSearchOpen(false); setCalendarOpen((open) => !open) }}
            onToggleInSessionSearch={() => { setCalendarOpen(false); setSearchOpen((open) => !open) }}
            onRefreshMessages={vi.fn()} onToggleDetailPanel={vi.fn()}
          />
        </DetailChromeProvider>
      )
    }

    render(<MemoryRouter><Harness /></MemoryRouter>)
    const calendar = await screen.findByRole('button', { name: '跳转到指定时间' })
    const search = screen.getByRole('button', { name: '搜索会话消息' })
    expect(calendar.getAttribute('aria-controls')).toBe('chat-jump-calendar-popover')
    expect(search.getAttribute('aria-controls')).toBe('chat-in-session-search-panel')
    expect(calendar.getAttribute('aria-expanded')).toBe('false')
    expect(search.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(calendar)
    expect(calendar.getAttribute('aria-expanded')).toBe('true')
    expect(search.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(search)
    expect(calendar.getAttribute('aria-expanded')).toBe('false')
    expect(search.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(search)
    expect(search.getAttribute('aria-expanded')).toBe('false')

    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    expect(chatPage).toContain('id="chat-jump-calendar-popover"')
    expect(chatPage).toContain('id="chat-in-session-search-panel"')
  })

  it('maps touched typography, wrapping, and narrow inspector placement to the approved tokens', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.scss'), 'utf8')
    expect(styles).toMatch(/\.message-header[^]*?h3\s*\{[^}]*font-size:\s*var\(--font-md/s)
    expect(styles).toMatch(/\.session-name\s*\{[^}]*text-overflow:\s*ellipsis/s)
    expect(styles).toMatch(/\.message-bubble[^]*?\.bubble-content\s*\{[^}]*font-size:\s*var\(--font-base/s)
    expect(styles).toMatch(/\.message-bubble[^]*?\.bubble-content\s*\{[^}]*overflow-wrap:\s*anywhere/s)
    expect(styles).toMatch(/\.message-area\.compact-inspector[^]*?\.detail-panel\s*\{[^}]*position:\s*absolute/s)
    expect(styles).toMatch(/\.detail-panel\s*\{[^}]*width:\s*min\(340px/s)
    expect(styles).toMatch(/\.message-area:not\(\.compact-inspector\)[^}]*\.message-list\s*\{[^}]*min-width:\s*320px/s)
  })

  it('gives every middle inspector complementary semantics and a focusable labelled title', () => {
    const chatPage = readFileSync(resolve(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
    for (const id of ['group-members-inspector-title', 'group-summary-inspector-title', 'session-detail-inspector-title']) {
      expect(chatPage).toContain(`aria-labelledby="${id}"`)
      expect(chatPage).toMatch(new RegExp(`id="${id}"[^>]*tabIndex=\\{-1\\}`))
    }
    expect(chatPage.match(/<aside className="detail-panel/g)).toHaveLength(3)
    expect(chatPage.match(/aria-modal="false"/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('SettingsModalShell behavior', () => {
  it('portals an accessible focus-trapped dialog and restores focus after Escape dismissal', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        process: { platform: 'linux', arch: 'x64' }
      }
    })
    const { SettingsModalShell } = await import('../src/pages/SettingsPage')
    const onClose = vi.fn()
    const previousFocus = document.createElement('button')
    previousFocus.textContent = '打开设置'
    document.body.appendChild(previousFocus)
    previousFocus.focus()

    const { unmount } = render(
      <div className="detail-pane">
        <SettingsModalShell onClose={onClose}>
          <button type="button">第一个控件</button>
          <button type="button">最后一个控件</button>
        </SettingsModalShell>
      </div>
    )

    const dialog = screen.getByRole('dialog', { name: '设置' })
    const first = screen.getByRole('button', { name: '第一个控件' })
    const last = screen.getByRole('button', { name: '最后一个控件' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.closest('.detail-pane')).toBeNull()
    expect(dialog.closest('.settings-modal-layer')?.parentElement).toBe(document.body)
    await waitFor(() => expect(document.activeElement).toBe(first))

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    expect(document.activeElement).toBe(previousFocus)
    previousFocus.remove()
  })

  it('scopes focus and Escape to active layered content before returning focus to Settings', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        process: { platform: 'linux', arch: 'x64' }
      }
    })
    const { SettingsModalShell } = await import('../src/pages/SettingsPage')
    const onClose = vi.fn()
    const onLayeredContentClose = vi.fn()
    const globalEscapeListener = vi.fn()
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') globalEscapeListener(event)
    }
    const launcher = document.createElement('button')
    launcher.textContent = '打开设置'
    document.body.appendChild(launcher)
    launcher.focus()
    document.addEventListener('keydown', handleGlobalKeyDown)

    const Harness = () => {
      const [showLayeredContent, setShowLayeredContent] = useState(true)
      return (
        <SettingsModalShell
          onClose={onClose}
          layeredContentLabel="微博 Cookie 设置"
          layeredContent={showLayeredContent
            ? (
                <div className="social-cookie-modal-overlay">
                  <button type="button">顶层第一个控件</button>
                  <button type="button">顶层最后一个控件</button>
                </div>
              )
            : null}
          onLayeredContentClose={() => {
            onLayeredContentClose()
            setShowLayeredContent(false)
          }}
        >
          <button type="button">设置第一个控件</button>
          <button type="button">设置最后一个控件</button>
        </SettingsModalShell>
      )
    }

    const { unmount } = render(<Harness />)
    const settingsDialog = document.querySelector('.settings-page') as HTMLElement
    const settingsFirst = settingsDialog.querySelector('button') as HTMLButtonElement
    const topFirst = screen.getByRole('button', { name: '顶层第一个控件' })
    const topLast = screen.getByRole('button', { name: '顶层最后一个控件' })
    expect(settingsDialog.getAttribute('aria-hidden')).toBe('true')
    expect(settingsDialog.hasAttribute('inert')).toBe(true)
    expect(settingsDialog.getAttribute('aria-modal')).toBeNull()
    expect(screen.getByRole('dialog', { name: '微博 Cookie 设置' }).getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(topFirst))

    topLast.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(topFirst)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(topLast)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onLayeredContentClose).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    expect(globalEscapeListener).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(settingsFirst))
    expect(screen.getByRole('dialog', { name: '设置' }).getAttribute('aria-modal')).toBe('true')
    expect(settingsDialog.getAttribute('aria-hidden')).toBeNull()
    expect(settingsDialog.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).not.toBe(launcher)

    unmount()
    expect(document.activeElement).toBe(launcher)
    document.removeEventListener('keydown', handleGlobalKeyDown)
    launcher.remove()
  })
})

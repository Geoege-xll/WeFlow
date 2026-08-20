import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startElectronMain } from '../electron/app-bootstrap'
import { APP_IDENTITY, OPEN_CHAT_CHANNEL_IDENTITY, appLocalEvent } from '../shared/app-identity'

const projectFile = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8')

const collectTextFiles = (relativeRoot: string): string[] => {
  const result: string[] = []
  const visit = (relativePath: string): void => {
    const absolutePath = resolve(process.cwd(), relativePath)
    if (statSync(absolutePath).isDirectory()) {
      for (const entry of readdirSync(absolutePath)) visit(`${relativePath}/${entry}`)
      return
    }
    if (/\.(?:ts|tsx|scss|css|html)$/.test(relativePath)) result.push(relativePath)
  }
  visit(relativeRoot)
  return result
}

describe('OmniMindWeChat 应用身份合同', () => {
  it('将产品、包、系统与本地目录身份集中为 clean-break 新值', () => {
    expect(APP_IDENTITY).toMatchObject({
      productName: 'OmniMindWeChat',
      packageName: 'omnimind-wechat',
      appId: 'com.omnimind.wechat',
      userDataDirectoryName: 'OmniMindWeChat',
      documentsDirectoryName: 'OmniMindWeChat',
      configFileBaseName: 'OmniMindWeChat-config',
      cacheMapFileName: 'OmniMindWeChat-cache-maps.json',
      localNamespace: 'omnimind-wechat'
    })
    expect(appLocalEvent('ready')).toBe('omnimind-wechat:ready')
  })

  it('让 electron-builder 与单一身份合同保持一致', () => {
    const packageJson = JSON.parse(projectFile('package.json'))
    expect(packageJson.name).toBe(APP_IDENTITY.packageName)
    expect(packageJson.description).toBe(APP_IDENTITY.productName)
    expect(packageJson.repository.url).toBe(APP_IDENTITY.github.url)
    expect(packageJson.build).toMatchObject({
      appId: APP_IDENTITY.appId,
      productName: APP_IDENTITY.productName,
      publish: {
        owner: APP_IDENTITY.github.owner,
        repo: APP_IDENTITY.github.repository
      },
      linux: {
        executableName: APP_IDENTITY.packageName
      }
    })
  })

  it('打包入口先配置身份再动态加载主进程，所有本地存储显式绑定同一 userData', () => {
    const bootstrap = projectFile('electron/bootstrap.ts')
    const main = projectFile('electron/main.ts')
    const config = projectFile('electron/services/config.ts')
    const vite = projectFile('vite.config.ts')
    const settings = projectFile('src/pages/SettingsPage.tsx')
    const packageJson = JSON.parse(projectFile('package.json'))

    expect(packageJson.main).toBe('dist-electron/main.js')
    expect(vite).toContain("entry: 'electron/main.ts'")
    expect(vite).toContain("entryFileNames: 'main-runtime.js'")
    expect(vite).toContain("entry: 'electron/bootstrap.ts'")
    expect(vite).toContain("entryFileNames: 'main.js'")
    expect(bootstrap).toContain("loadMain: async () => require('./main-runtime.js')")
    expect(bootstrap).not.toMatch(/from\s+['"]\.\/main['"]/)
    expect(main).not.toContain("app.setPath('userData'")
    expect(main).toContain('APP_IDENTITY.documentsDirectoryName')
    expect(config).toContain('APP_IDENTITY.configFileBaseName')
    expect(config).toContain('cwd: this.getUserDataPath()')
    expect(vite).toContain("join(appDataPath(), '${APP_IDENTITY.userDataDirectoryName}')")
    expect(settings).toContain('~/Documents/OmniMindWeChat')

    for (const content of [bootstrap, main, config, vite, settings]) {
      expect(content).not.toContain('Application Support/WeFlow')
      expect(content).not.toContain('Documents/WeFlow')
      expect(content).not.toContain('WeFlow-config')
      expect(content).not.toContain('WeFlow-cache')
    }
  })

  it('执行启动时序：ConfigStore 求值前已固定最终名称和绝对路径', async () => {
    const calls: string[] = []
    const paths = {
      appData: '/Users/test/Library/Application Support',
      userData: '/Users/test/Library/Application Support/omnimind-wechat'
    }
    let applicationName = APP_IDENTITY.packageName
    let configStorePathAtEvaluation = ''

    const finalUserDataPath = await startElectronMain({
      app: {
        getPath: (name) => paths[name],
        setName: (name) => {
          applicationName = name
          calls.push('setName')
        },
        setPath: (name, path) => {
          paths[name] = path
          calls.push('setPath')
        }
      },
      // 这个 loader 对应打包入口的 dynamic import：在它被调用时模拟 electron-store
      // 构造路径，直接验证模块求值看到的是 bootstrap 后的最终 userData。
      loadMain: async () => {
        calls.push('loadMain')
        expect(applicationName).toBe(APP_IDENTITY.productName)
        expect(paths.userData).toBe(join(paths.appData, APP_IDENTITY.userDataDirectoryName))
        configStorePathAtEvaluation = join(paths.userData, `${APP_IDENTITY.configFileBaseName}.json`)
      }
    })

    expect(calls).toEqual(['setName', 'setPath', 'loadMain'])
    expect(finalUserDataPath).toBe(paths.userData)
    expect(basename(finalUserDataPath)).toBe('OmniMindWeChat')
    expect(dirname(configStorePathAtEvaluation)).toBe(finalUserDataPath)
  })

  it('关键启动与协议页面只展示精确产品名称', () => {
    const splash = projectFile('public/splash.html')
    const dualReport = projectFile('src/pages/DualReportWindow.tsx')
    const agreement = projectFile('src/pages/AgreementPage.tsx')

    expect(splash).toContain('<span class="header-left">OmniMindWeChat</span>')
    expect(splash).not.toContain('OMNIMIND_WECHAT')
    expect(dualReport).toContain('OmniMindWeChat · DUAL RECORD')
    expect(dualReport).not.toContain('OMNIMIND_WECHAT · DUAL RECORD')
    expect(agreement).toContain('欢迎使用 OmniMindWeChat 软件。')
    expect(agreement).not.toContain('欢迎使用OmniMindWeChat（OmniMindWeChat）软件')
  })

  it('保持 Open Chat 服务端渠道与幂等前缀，且仅从协议常量读取', () => {
    expect(OPEN_CHAT_CHANNEL_IDENTITY).toEqual({
      application: 'weflow',
      channel: 'wechat',
      idempotencyPrefix: 'weflow'
    })
    const client = projectFile('electron/omnimind/omnimind-python-client.ts')
    expect(client).toContain('OPEN_CHAT_CHANNEL_IDENTITY.application')
    expect(client).toContain('OPEN_CHAT_CHANNEL_IDENTITY.idempotencyPrefix')
    expect(client).not.toContain("application: 'weflow'")
  })

  it('使用 App 通用组件与新的 Linux 安装身份', () => {
    for (const component of ['AppCard', 'AppDialog', 'AppPageContainer', 'AppSearch', 'AppTabs']) {
      expect(existsSync(resolve(process.cwd(), `src/components/common/${component}.tsx`))).toBe(true)
      expect(existsSync(resolve(process.cwd(), `src/components/common/${component}.scss`))).toBe(true)
    }
    expect(existsSync(resolve(process.cwd(), 'src/components/common/WeFlowDialog.tsx'))).toBe(false)

    const installer = projectFile('resources/installer/linux/install.sh')
    const desktop = projectFile('resources/installer/linux/omnimind-wechat.desktop')
    const pkgbuild = projectFile('resources/installer/linux/PKGBUILD')
    expect(installer).toContain('APP_EXEC="omnimind-wechat"')
    expect(desktop).toContain('Exec=/usr/bin/omnimind-wechat %U')
    expect(pkgbuild).toContain('pkgname=omnimind-wechat')
    expect([installer, desktop, pkgbuild].join('\n')).not.toContain('/usr/bin/weflow')
  })

  it('更新源只指向当前 GitHub 仓库', () => {
    const main = projectFile('electron/main.ts')
    const packageJson = JSON.parse(projectFile('package.json'))
    expect(main).toContain('APP_IDENTITY.github.releasesUrl')
    expect(main).not.toContain('hicccc77/WeFlow/releases')
    expect(APP_IDENTITY.github.url).toBe('https://github.com/Geoege-xll/WeFlow')
    expect(packageJson.repository.url).toBe('https://github.com/Geoege-xll/WeFlow')
    expect(packageJson.build.publish).toMatchObject({ owner: 'Geoege-xll', repo: 'WeFlow' })
  })

  it('禁止旧品牌重新散落到未分类的生产代码', () => {
    // 允许项均有明确边界：应用身份合同、Open Chat 稳定协议、上游历史说明，或无法随
    // TypeScript 单方面改名的原生资源 ABI。任何新文件出现旧名称都会让测试直接失败。
    const productionFiles = ['electron', 'src', 'shared'].flatMap(collectTextFiles)
    const productionSource = productionFiles.map(projectFile).join('\n')
    expect(productionSource).not.toContain('hicccc77/WeFlow')

    const classifiedLegacyReference = /(?:github\.com\/Geoege-xll\/WeFlow|repository: 'WeFlow'|(?:application|idempotencyPrefix): 'weflow'|Open Chat .*`weflow`|旧 WeFlow|WeFlow 二开|weflow_monitor|weflow-wcdb|weflow-image-native|weflow-export)/
    const unexpected = productionFiles
      .flatMap((path) => projectFile(path)
        .split('\n')
        .map((line, index) => ({ path, line, lineNumber: index + 1 })))
      .filter(({ line }) => /weflow/i.test(line) && !classifiedLegacyReference.test(line))
      .map(({ path, lineNumber, line }) => `${path}:${lineNumber}:${line.trim()}`)
    expect(unexpected).toEqual([])
  })
})

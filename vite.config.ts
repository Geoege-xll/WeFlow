import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron, { startup as electronStartup } from 'vite-plugin-electron'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { createElectronRestartCoordinator, type ElectronStartOptions } from './electron/dev-lifecycle'
import { APP_IDENTITY } from './shared/app-identity'

const electronRestartCoordinator = createElectronRestartCoordinator({
  stopOwnedChild: () => electronStartup.exit()
})

const handleElectronMainOnStart = (options: ElectronStartOptions): void => {
  void electronRestartCoordinator.restart(options)
}

const handleElectronRuntimeOnStart = (options: ElectronStartOptions): void => {
  // 首次开发构建必须等 bootstrap 入口就绪后再启动；后续 main-runtime 热更新则复用
  // 同一重启协调器。这样独立入口既保证生产求值顺序，也不牺牲开发期自动重启。
  if (existsSync(resolve(process.cwd(), 'dist-electron/main.js'))) {
    handleElectronMainOnStart(options)
  }
}

const closeElectronDevLifecycle = (): void => {
  void electronRestartCoordinator.close()
}

const exportWorkerElectronShimPlugin = () => {
  const virtualId = 'virtual:omnimind-wechat-export-worker-electron'
  const resolvedVirtualId = `\0${virtualId}`

  return {
    name: 'omnimind-wechat-export-worker-electron-shim',
    enforce: 'pre' as const,
    resolveId(id: string) {
      if (id === virtualId) return resolvedVirtualId
      return null
    },
    load(id: string) {
      if (id !== resolvedVirtualId) return null
      return `
        import { homedir, tmpdir } from 'os'
        import { join } from 'path'

        const workerUserDataPath = () => String(process.env.OMNIMIND_WECHAT_USER_DATA_PATH || process.env.OMNIMIND_WECHAT_CONFIG_CWD || '').trim()
        const appDataPath = () => {
          if (process.platform === 'win32' && process.env.APPDATA) return process.env.APPDATA
          if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
          return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
        }
        const getPath = (name) => {
          if (name === 'userData') return workerUserDataPath() || join(appDataPath(), '${APP_IDENTITY.userDataDirectoryName}')
          if (name === 'documents') return join(homedir(), 'Documents')
          if (name === 'desktop') return join(homedir(), 'Desktop')
          if (name === 'downloads') return join(homedir(), 'Downloads')
          if (name === 'temp') return tmpdir()
          if (name === 'appData') return appDataPath()
          return process.cwd()
        }

        export const app = {
          isPackaged: Boolean(process.resourcesPath && process.env.NODE_ENV !== 'development'),
          getPath,
          getAppPath: () => process.cwd(),
          getName: () => '${APP_IDENTITY.productName}',
          getVersion: () => process.env.npm_package_version || '0.0.0',
          // Worker 中不存在 app 生命周期事件（如 will-quit），no-op 兼容注册退出钩子的服务
          on: () => app,
          once: () => app,
          off: () => app,
          removeListener: () => app,
          removeAllListeners: () => app
        }
        export const BrowserWindow = { getAllWindows: () => [], getFocusedWindow: () => null }
        export const dialog = { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) }
        export const shell = { openExternal: async () => false, showItemInFolder: () => {} }
        export const ipcMain = { on: () => {}, handle: () => {}, removeHandler: () => {} }
        export const ipcRenderer = { sendSync: () => ({}) }
        export const safeStorage = {
          isEncryptionAvailable: () => false,
          encryptString: (value) => Buffer.from(String(value || ''), 'utf8'),
          decryptString: (value) => Buffer.isBuffer(value) ? value.toString('utf8') : Buffer.from(value).toString('utf8')
        }
        export const Notification = class {
          static isSupported() { return false }
          on() { return this }
          show() {}
          close() {}
        }
        export default { app, BrowserWindow, dialog, shell, ipcMain, ipcRenderer, safeStorage, Notification }
      `
    },
    transform(code: string, id: string) {
      if (!/\.[cm]?[jt]s$/.test(id)) return null
      if (!code.includes("'electron'") && !code.includes('"electron"')) return null
      const next = code
        .replace(/from\s+(['"])electron\1/g, `from '${virtualId}'`)
        .replace(/import\s*\(\s*(['"])electron\1\s*\)/g, `import('${virtualId}')`)
        .replace(/require\s*\(\s*(['"])electron\1\s*\)/g, `require('${virtualId}')`)
      return next === code ? null : { code: next, map: null }
    }
  }
}

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    strictPort: false  // 如果3000被占用，自动尝试下一个
  },
  build: {
    chunkSizeWarningLimit: 900,
    commonjsOptions: {
      ignoreDynamicRequires: true
    }
  },
  optimizeDeps: {
    exclude: []
  },
  plugins: [
    react(),
    {
      name: 'omnimind-wechat-electron-dev-lifecycle',
      configureServer(server) {
        server.httpServer?.once('close', () => {
          closeElectronDevLifecycle()
        })
      }
    },
    electron([
      {
        // 业务主进程独立产出，不能与 bootstrap 共用模块图；否则 bundler 可能把
        // ConfigService 等传递依赖提升到 app.setPath(userData) 之前。
        entry: 'electron/main.ts',
        onstart: handleElectronRuntimeOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'better-sqlite3',
                'koffi',
                'fsevents',
                'whisper-node',
                'shelljs',
                'exceljs',
                'node-llama-cpp',
                '@vscode/sudo-prompt',
                'silk-wasm',
                // 原生 .node 二进制不可打包，运行时从 asarUnpack 目录解析
                '@hicccc77/electron-liquid-glass'
              ],
              output: {
                entryFileNames: 'main-runtime.js'
              }
            }
          }
        }
      },
      {
        entry: 'electron/bootstrap.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', './main-runtime.js'],
              // package.json 始终只进入窄 bootstrap；它以运行时 require 加载已经完成
              // 单独构建的 main-runtime.js，打包产物层面也不存在业务依赖前置求值。
              output: {
                entryFileNames: 'main.js'
              }
            }
          }
        }
      },
      {
        entry: 'electron/annualReportWorker.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'koffi',
                'fsevents'
              ],
              output: {
                entryFileNames: 'annualReportWorker.js',
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        entry: 'electron/dualReportWorker.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'koffi',
                'fsevents'
              ],
              output: {
                entryFileNames: 'dualReportWorker.js',
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        entry: 'electron/imageSearchWorker.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                entryFileNames: 'imageSearchWorker.js',
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        entry: 'electron/imageDecryptWorker.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                entryFileNames: 'imageDecryptWorker.js',
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        entry: 'electron/wcdbWorker.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'better-sqlite3',
                'koffi',
                'fsevents'
              ],
              output: {
                entryFileNames: 'wcdbWorker.js',
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        entry: 'electron/transcribeWorker.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'sherpa-onnx-node'
              ],
              output: {
                entryFileNames: 'transcribeWorker.js',
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        entry: 'electron/exportWorker.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          plugins: [exportWorkerElectronShimPlugin()],
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'better-sqlite3',
                'koffi',
                'fsevents',
                'exceljs'
              ],
              output: {
                entryFileNames: 'exportWorker.js',
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        entry: 'electron/apiMessageWorker.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                entryFileNames: 'apiMessageWorker.js',
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart: handleElectronMainOnStart,
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ])
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})

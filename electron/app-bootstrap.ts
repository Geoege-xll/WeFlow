import { join } from 'path'
import { APP_IDENTITY } from '../shared/app-identity'

/**
 * Electron 启动最早阶段所需的最小能力。
 *
 * 这里刻意不依赖任何业务服务，也不直接导入 ConfigService。否则 ES 模块会先求值静态
 * imports，被业务单例抢先创建 electron-store，再次把配置写入错误的默认目录。
 */
export interface ElectronIdentityApp {
  getPath(name: 'appData' | 'userData'): string
  setName(name: string): void
  setPath(name: 'userData', path: string): void
}

export interface ElectronMainBootstrapDependencies {
  app: ElectronIdentityApp
  loadMain: () => Promise<unknown>
}

/**
 * 同步冻结应用名与 userData 绝对路径。调用者必须在加载任何业务模块之前执行此函数。
 */
export const configureElectronAppIdentity = (app: ElectronIdentityApp): string => {
  app.setName(APP_IDENTITY.productName)
  const userDataPath = join(app.getPath('appData'), APP_IDENTITY.userDataDirectoryName)
  app.setPath('userData', userDataPath)
  return userDataPath
}

/**
 * 唯一合法的桌面主进程启动顺序：先同步固定身份，再加载真正的 main 模块。
 * loadMain 采用依赖注入，使测试能够真实执行并观察模块求值发生时的 userData 值。
 */
export const startElectronMain = async (
  dependencies: ElectronMainBootstrapDependencies
): Promise<string> => {
  const userDataPath = configureElectronAppIdentity(dependencies.app)
  await dependencies.loadMain()
  return userDataPath
}

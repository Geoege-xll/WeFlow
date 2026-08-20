import { app } from 'electron'
import { startElectronMain } from './app-bootstrap'

/**
 * 打包入口只能保持这条窄边界：身份配置完成前禁止静态导入 main 或任何业务服务。
 * 延迟 loader 会在 startElectronMain 已同步 setName/setPath 后才求值独立业务制品，
 * 因此求值期创建的 ConfigService、缓存、日志与 Chromium profile 必然共享同一 userData。
 */
void startElectronMain({
  app,
  // main-runtime.js 由独立构建入口产出。这里使用延迟 require 而不是让打包器看到
  // dynamic import 图，防止 Rolldown 把业务 chunk 的传递依赖提升到身份配置之前。
  loadMain: async () => require('./main-runtime.js')
}).catch((error) => {
  console.error('[OmniMindWeChat] 主进程启动失败:', error)
  app.exit(1)
})

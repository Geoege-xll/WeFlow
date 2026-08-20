/**
 * OmniMindWeChat 的应用身份单一真源。
 *
 * 产品显示名、本地目录、更新仓库与服务端渠道身份属于四类不同合同。将它们集中在这里，
 * 可以防止以后品牌调整时误改 Open Chat 的稳定来源标识，或让主进程、Worker 与安装器
 * 各自推导出不同的数据目录。package.json 和平台安装脚本无法直接导入 TypeScript，相关
 * 回归测试会逐项校验这些声明式配置与本文件保持一致。
 */
export const APP_IDENTITY = Object.freeze({
  productName: 'OmniMindWeChat',
  packageName: 'omnimind-wechat',
  appId: 'com.omnimind.wechat',
  userDataDirectoryName: 'OmniMindWeChat',
  documentsDirectoryName: 'OmniMindWeChat',
  configFileBaseName: 'OmniMindWeChat-config',
  cacheMapFileName: 'OmniMindWeChat-cache-maps.json',
  localNamespace: 'omnimind-wechat',
  environmentPrefix: 'OMNIMIND_WECHAT',
  github: Object.freeze({
    owner: 'Geoege-xll',
    repository: 'WeFlow',
    url: 'https://github.com/Geoege-xll/WeFlow',
    releasesUrl: 'https://github.com/Geoege-xll/WeFlow/releases'
  })
} as const)

/**
 * Open Chat 已将 `weflow` 写入服务端客户、会话与幂等记录。它是跨版本协议主键，
 * 不是产品显示名；即使桌面应用采用 clean-break 本地身份，也必须保持此值不变。
 */
export const OPEN_CHAT_CHANNEL_IDENTITY = Object.freeze({
  application: 'weflow',
  channel: 'wechat',
  idempotencyPrefix: 'weflow'
} as const)

/** 生成 OmniMindWeChat 自有、不会与旧应用共享的 Renderer 本地事件名。 */
export const appLocalEvent = (eventName: string): string =>
  `${APP_IDENTITY.localNamespace}:${eventName}`

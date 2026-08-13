export type ChatImageFailureKind = 'not_found' | 'decrypt_failed'

export interface ChatImageFailureInput {
  primary?: { error?: unknown; failureKind?: ChatImageFailureKind }
  fallbackError?: unknown
  caughtError?: unknown
  rendererLoadError?: boolean
}

export interface ChatImageFailureViewModel {
  reason: string
  failureKind: ChatImageFailureKind
}

const classifyKnownReason = (value: unknown): ChatImageFailureViewModel | null => {
  if (typeof value !== 'string') return null
  const reason = value.trim()
  if (!reason) return null

  if (/未配置账号或数据库路径|配置数据库路径|配置微信ID/.test(reason)) {
    return { reason: '未配置账号或数据库路径', failureKind: 'not_found' }
  }
  if (/未找到账号目录/.test(reason)) {
    return { reason: '未找到账号目录，请检查数据库路径和账号配置', failureKind: 'not_found' }
  }
  if (/未找到图片文件|未找到缓存图片/.test(reason)) {
    return {
      reason: /微信中点开/.test(reason)
        ? '未找到图片文件，请在微信中点开后重试'
        : '未找到本地图片文件',
      failureKind: 'not_found'
    }
  }
  if (/未找到消息/.test(reason)) {
    return { reason: '未找到对应图片消息', failureKind: 'not_found' }
  }
  if (/缺少图片标识|缺少 md5\/datName/.test(reason)) {
    return { reason: '图片标识缺失，无法定位原文件', failureKind: 'not_found' }
  }
  if (/未配置图片解密密钥|配置解密密钥/.test(reason)) {
    return { reason: '未配置图片解密密钥', failureKind: 'not_found' }
  }
  if (/原生解密不可用|native 模块|Rust原生解密/.test(reason)) {
    return { reason: '原生图片解密不可用，请检查组件与密钥配置', failureKind: 'decrypt_failed' }
  }
  if (/路径无效|内容无效|无效图片|base64/i.test(reason)) {
    return { reason: '图片内容或缓存路径无效', failureKind: 'decrypt_failed' }
  }
  return null
}

export const resolveChatImageFailure = (input: ChatImageFailureInput): ChatImageFailureViewModel => {
  if (input.rendererLoadError) {
    return { reason: '图片已解密，但渲染加载失败', failureKind: 'decrypt_failed' }
  }

  const primary = classifyKnownReason(input.primary?.error)
  if (primary) return primary

  const fallback = classifyKnownReason(input.fallbackError)
  if (fallback) return fallback

  const caught = classifyKnownReason(input.caughtError)
  if (caught) return caught

  return {
    reason: '图片解密失败，请重试或检查图片配置',
    failureKind: input.primary?.failureKind === 'not_found' ? 'not_found' : 'decrypt_failed'
  }
}

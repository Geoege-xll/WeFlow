export const isSendableChatSession = (sessionId?: string | null): boolean => {
  const normalized = String(sessionId || '').trim()
  if (!normalized) return false
  if (normalized.toLowerCase().includes('placeholder_foldgroup')) return false
  if (normalized.startsWith('gh_')) return false
  const systemAccounts = ['weixin', 'fmessage', 'medianote', 'newsapp', 'tmessage', 'qmessage', 'qqmail', 'floatbottle']
  if (systemAccounts.includes(normalized)) return false
  return true
}

export const getOmniMindChatMountPolicy = (
  standaloneSessionWindow: boolean,
  hasCurrentSession: boolean,
  sessionId?: string | null
) => ({
  composer: !standaloneSessionWindow && hasCurrentSession && (sessionId === undefined || isSendableChatSession(sessionId)),
  // 聊天页只保留真实人工发送器；自动托管队列与状态统一由首页挂载。
  queue: false
})

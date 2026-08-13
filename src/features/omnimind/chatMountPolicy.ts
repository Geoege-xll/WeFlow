export const getOmniMindChatMountPolicy = (standaloneSessionWindow: boolean, hasCurrentSession: boolean) => ({
  composer: !standaloneSessionWindow && hasCurrentSession,
  queue: !standaloneSessionWindow
})

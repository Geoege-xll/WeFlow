export const omniMindZhCN = {
  locale: 'zh-CN', title: 'OmniMind 托管', queueTitle: '自动托管', queueContext: '全局串行队列', queueLabel: 'OmniMind AI 串行处理队列',
  hosting: { running: '自动托管运行中', stopped: '自动托管已停止', validating: '正在验证设置', starting: '正在启动监控', degraded: '队列保留，自动接入受限', stopping: '正在安全停止', failed: '启动失败', switch: '自动托管', enable: '开启自动托管', disable: '停止自动托管', settings: '自动托管设置', commandFailed: '操作失败，请重试。' },
  runtime: { degradedReason: '自动接入受限，现有队列和待确认回复已保留。', failedReason: '自动托管启动失败，请检查设置后重试。', reviewSettings: '检查自动托管设置', validatingEmpty: '正在验证设置，队列保持可见。', startingEmpty: '正在启动监控，队列保持可见。', stoppingEmpty: '正在安全停止，未发送任务会按现有规则处理。', degradedEmpty: '队列已保留，等待自动接入恢复。' },
  metrics: { current: '当前', waiting: '等待', awaiting: '待确认' },
  groups: { current: '当前任务', waiting: '等待队列', awaiting: '等待你发送', recent: '最近结果' },
  taskStatus: { queued: '等待中', generating: '正在生成', waiting_to_send: '等待发送', awaiting_manual_send: '等待你发送', sending: '正在发送', sent: '已发送', delivery_unconfirmed: '发送结果未确认', cancelled: '已取消', generation_failed: '生成失败', send_failed: '发送失败' },
  taskType: 'AI 文本任务',
  taskReason: { manual_send_same_session: '因该会话手动发送而取消', manual_abandoned: '已放弃这条 AI 回复', hosting_disabled: '因自动托管停止而取消', critical_settings_changed: '因关键设置变更而取消', account_changed: '因账号切换而取消', user_cancelled: '已由用户取消', handoff: '需要人工接管，不会自动发送' } as Record<string, string>,
  actions: { cancel: '取消', retry: '重试', retrySend: '重试发送', recheck: '重新检查', inspectConversation: '打开会话检查', inspectHosting: '检查托管状态', confirmSentDiscard: '已确认已发送，丢弃旧草稿', save: '保存设置', saving: '正在保存…', close: '关闭设置', discard: '丢弃更改', continueEditing: '继续编辑', discardChanges: '放弃更改', confirmCritical: '停止托管并保存', send: '发送', inspectBeforeSend: '先检查会话', abandon: '放弃', test: '测试当前草稿', testing: '正在测试…', clearKey: '清除已保存 Key', refresh: '重试', clear: '清空', selectResults: '选择当前搜索结果', selectAll: '全选全部可托管联系人' },
  empty: { running: '自动托管运行中，正在等待新消息', stopped: '自动托管已停止' },
  composer: { label: '手动发送文本', placeholder: '输入文本；Enter 发送，Shift+Enter 换行', waiting: '等待当前发送完成…', failed: '发送失败，请保留文本后重试。', preserved: '输入已保留。Enter 发送，Shift+Enter 换行。', tooManyPending: '当前有多条消息正在等待发送结果。此草稿已保留，请稍后重试。', sentResolved: '已按你的确认丢弃旧草稿；此操作没有再次发送消息。', inspectedNotSent: '已检查且未发送', inspectedReady: '已确认会话中没有该消息。需要发送时，请再次单独点击发送或按 Enter。' },
  recovery: { conversationFocused: '已进入当前会话消息区域，请检查最新消息。', conversationUnavailable: '当前会话消息区域暂不可用，请返回聊天后检查。', settingsOpened: '已打开自动托管设置。', helpShown: '已显示安全恢复步骤。' },
  failure: {
    verificationBaseline: { status: '发送准备失败', fact: '无法读取发送前的微信消息记录。尚未执行微信发送。', nextStep: '确认 WeFlow 能读取当前会话后，再重新检查。', action: '重新检查' },
    accessibility: { status: '需要辅助功能权限', fact: 'WeFlow 没有控制微信所需的辅助功能权限。尚未发送。', nextStep: '打开权限中心的辅助功能卡片，并按提示恢复。', action: '查看授权步骤' },
    automationPermission: { status: '需要自动化权限', fact: 'WeFlow 没有控制微信界面所需的自动化权限。尚未发送。', nextStep: '打开权限中心的自动化卡片，并按提示恢复。', action: '查看授权步骤' },
    targetAmbiguous: { status: '无法确定目标', fact: '找到多个匹配会话，无法安全确定发送目标。尚未发送。', nextStep: '在微信中只保留并打开正确会话，再重试。', action: '查看目标检查步骤' },
    targetMismatch: { status: '目标不匹配', fact: '当前微信会话与任务目标不一致。尚未发送。', nextStep: '切换到正确会话并确认标题后，再重试。', action: '查看目标检查步骤' },
    inputUnavailable: { status: '输入区不可用', fact: '无法定位可用的微信输入框。尚未发送。', nextStep: '确认微信窗口已解锁且会话输入区可用。', action: '查看窗口检查步骤' },
    automationTimeout: { status: '自动化超时', fact: '自动化操作超时，发送结果无法确认。', nextStep: '请先检查微信会话；不要直接重试，以免重复发送。', action: '打开会话检查' },
    deliveryUnconfirmed: { status: '发送结果未确认', fact: '发送动作可能已执行，但消息记录尚未确认。', nextStep: '请先检查微信会话；确认未发送后再决定是否重发。', action: '打开会话检查' },
    unknown: { status: '发送状态未知', fact: '发送状态暂时无法确认。为安全起见，系统没有自动重试。', nextStep: '请检查微信会话和 WeFlow 状态；仍无法判断时暂停托管。', action: '打开会话检查' }
  },
  settings: {
    tabs: { connection: '连接与凭据', scope: '托管范围', strategy: '回复策略', timing: '时序与超时', permissions: '权限中心' },
    endpoint: 'Base URL', endpointHelp: '支持本机 HTTP 或远端 HTTPS；保存时规范化为 /api/v1/open。', endpointInvalid: '请输入本机 HTTP 或远端 HTTPS 地址，且不要包含凭据、查询或片段。',
    apiKey: '新 API Key', apiKeyHelp: '留空将保留已保存密钥；输入后保存会替换。', keyConfigured: '已安全配置', keyMissing: '未配置', keyCleared: '已清除保存的 API Key，自动托管保持停止。', showDraft: '显示草稿', hideDraft: '隐藏草稿', clearKeyConfirm: '立即清除后自动托管将停止；当前密钥无法恢复。',
    connectionSuccess: '连接成功', connectionFailed: '连接测试失败，请检查地址、密钥和服务状态。', connectionErrors: { auth: '凭据验证失败，请检查 API Key。', network: '无法连接服务，请检查网络与地址。', timeout: '连接测试超时，请稍后重试。', incompatible: '目标服务响应不兼容，请确认 Open Channel 地址。' },
    selected: '指定联系人', all: '全部联系人', allRisk: '新出现的联系人也会自动纳入托管。', allConfirm: '我了解 AI 将响应所有符合条件的新入站文本消息',
    search: '搜索姓名、备注、微信号或会话 ID', filterAll: '全部', filterFriend: '好友', filterGroup: '群聊', filterOfficial: '官方账号', selectedCount: '已选', unavailable: '联系人暂不可用', officialFiltered: '当前被过滤，不会触发托管', contactsLoading: '正在加载联系人…', contactsEmpty: '未找到可托管联系人', contactsError: '无法加载联系人；已选范围仍会保留。', noResults: '没有匹配的联系人', coverage: '预计覆盖', coverageUnknown: '当前无法估算覆盖数', boundedResults: '仅显示前 40 项，请继续搜索缩小范围', recentSession: '最近会话', noRecentSession: '无最近会话', removeFilteredOfficial: '已选官方账号将从有效托管范围排除：', confirmRemoveOfficial: '确认移除已过滤的官方账号', contactTypes: { friend: '好友', group: '群聊', official: '官方账号', former_friend: '已删除好友', blocked: '已屏蔽', other: '其他' },
    autoSend: 'AI 生成完成后自动发送', manualReview: 'AI 生成后等待你确认', ignoreOfficial: '过滤官方账号', batchWindow: '消息批处理窗口（秒）', requestTimeout: '请求超时（秒）',
    criticalWarning: '运行中保存关键设置会停止托管并取消尚未实际发送的 AI 任务；等待你发送的回复会保留，保存后不会自动重启。', criticalChanges: { endpoint: '服务地址', key: 'API Key', scope: '托管范围', official: '官方账号过滤' }, errorSummary: '请修正以下设置：', timingInvalid: '时序与超时必须在允许范围内。', savedStopped: '设置已保存，自动托管未重启。', saved: '设置已保存，自动托管继续运行。', saveFailed: '设置保存失败，请重试。', discardTitle: '放弃未保存的更改？', discardConfirm: '有未保存的更改，确定丢弃吗？', migrationNotice: '旧版托管范围为空，请重新选择联系人或明确确认全部联系人。'
  },
  permissions: {
    title: 'macOS 权限',
    intro: 'WeFlow 需要两项独立的 macOS 权限。获得其中一项不代表另一项也已获得。',
    safeCheck: '检查权限只读取 macOS 返回的状态，不会激活微信、写入文本或发送消息。',
    loading: '正在读取',
    readFailed: '暂时无法读取权限状态，请稍后重新检查。',
    commandFailed: '权限操作未完成，请按当前卡片提示重试。',
    checking: '正在重新检查 macOS 权限。',
    checked: '权限状态已更新；不会自动开启托管或发送消息。',
    states: { not_requested: '尚未请求', unknown: '等待重新检查', granted: '已允许', denied: '未允许', unsupported: '当前系统不支持' },
    safePause: '所需权限不可用，自动接入保持安全暂停；队列、待确认回复和草稿均已保留。',
    actions: { continue: '继续', openSettings: '打开系统设置', recheck: '重新检查', recover: '恢复权限' },
    jit: { title: '开启自动托管前', switchDescription: '权限未就绪。激活后会先打开权限说明，不会立即开启自动托管。', body: 'WeFlow 需要辅助功能和自动化两项独立权限，才能安全识别并操作当前微信界面。', systemOwned: '继续后仅由 macOS 显示自己的权限提示；WeFlow 不会绘制或替代系统选择。' },
    requesting: { accessibility: '已请求 macOS 显示辅助功能提示；返回 WeFlow 后请重新检查。', automation: '已请求 macOS 显示自动化提示；返回 WeFlow 后请重新检查。' },
    opening: { accessibility: '正在 macOS 系统设置中管理辅助功能；返回 WeFlow 后请重新检查。', automation: '正在 macOS 系统设置中管理自动化；返回 WeFlow 后请重新检查。' },
    returned: { accessibility: '已返回 WeFlow。请重新检查辅助功能权限。', automation: '已返回 WeFlow。请重新检查自动化权限。' },
    cards: {
      accessibility: {
        title: '辅助功能', purpose: '让 WeFlow 识别当前微信窗口、会话和输入区域。',
        help: { not_requested: '只有你点击继续后，WeFlow 才会请求 macOS 显示系统提示。', unknown: '返回 WeFlow 后请主动重新检查。检查本身不会操作微信。', granted: 'macOS 已允许此权限。状态变化不会自动开启托管。', denied: 'macOS 未允许此权限。请打开系统设置完成选择，再返回重新检查。', unsupported: '当前系统不提供这项能力，自动托管保持关闭。' }
      },
      automation: {
        title: '自动化（Apple Events）', purpose: '让 WeFlow 仅向“系统事件”发送用于控制微信界面的 Apple Events。',
        help: { not_requested: '此权限独立于辅助功能。获得其中一项不代表另一项也已获得。', unknown: '返回 WeFlow 后请主动重新检查。此权限仍与辅助功能分开判断。', granted: 'macOS 已允许自动化权限；辅助功能仍须独立允许。', denied: '此权限独立于辅助功能。macOS 未允许自动化权限，请打开系统设置完成选择，再返回重新检查。', unsupported: '当前系统不提供这项能力，自动托管保持关闭。' }
      }
    }
  },
  queue: { generatedAt: '生成于', stale: '此后有新消息，请复核', staleConfirm: '这条回复生成后收到了新消息。再次发送将确认仍使用这条回复。', abandonConfirm: '放弃这条 AI 回复？此操作不会发送消息。', expand: '展开完整回复', collapse: '收起完整回复' },
  loading: '正在加载 AI 队列…', error: '队列状态加载失败，请重试。', taskCommandFailed: '任务操作失败，请重试。',
  skip: { sessions: '跳到会话列表', messages: '跳到消息区域', queue: '跳到 AI 队列' }
} as const

/**
 * AI 托管设置的语义标签合同。
 *
 * 设置弹窗和托管中心必须消费同一份有序描述，不能各自依赖对象键顺序或维护一套数组；
 * 这样标签名称、键盘导航顺序和 ARIA panel 身份才能在后续演进时保持一致。
 */
export const OMNIMIND_SETTINGS_TABS = [
  { id: 'connection', label: '连接与凭据' },
  { id: 'scope', label: '托管范围' },
  { id: 'response', label: '回复与时序' },
  { id: 'permissions', label: '权限中心' }
] as const

export type OmniMindSettingsTabId = (typeof OMNIMIND_SETTINGS_TABS)[number]['id']

const omniMindSettingsTabLabels = Object.fromEntries(
  OMNIMIND_SETTINGS_TABS.map(({ id, label }) => [id, label])
) as Record<OmniMindSettingsTabId, string>

export const omniMindZhCN = {
  locale: 'zh-CN', title: 'OmniMind 托管', queueTitle: '自动托管', queueContext: '全局串行队列', queueLabel: 'OmniMind AI 串行处理队列',
  hosting: { running: '自动托管运行中', paused: '自动托管已暂停', stopped: '自动托管已停止', validating: '正在验证设置', starting: '正在启动监控', degraded: '队列保留，自动接入受限', stopping: '正在安全停止', failed: '启动失败', switch: '自动托管', enable: '开启自动托管', pause: '暂停托管', resume: '继续托管', disable: '停止自动托管', settings: 'AI 托管与自动化设置', commandFailed: '操作失败，请重试。' },
  hostingCenter: {
    title: 'AI 自动托管中心',
    subtitleStopped: '打开控制中心不会启动自动托管',
    subtitleRunning: '关闭控制中心不会停止正在运行的自动托管',
    statusLabel: 'AI 自动托管',
    openStopped: '开启托管…',
    openRunning: '管理托管…',
    openBusy: '状态切换中…',
    close: '关闭 AI 自动托管中心',
    closeWithoutStopping: '关闭（不停止）',
    start: '开启自动托管',
    stop: '停止托管…',
    stopTitle: '停止自动托管？',
    stopDescription: '停止后不再处理新消息；当前队列与待确认内容会保留以便检查。',
    confirmStop: '确认停止托管',
    tabs: { overview: '概览与队列', ...omniMindSettingsTabLabels }
  },
  overview: {
    runningTitle: 'AI 代班员正在值守',
    runningDescription: '新消息会按托管范围进入全局串行队列。',
    pausedTitle: '自动托管已暂停',
    pausedDescription: '保留队列上下文，不继续领取新任务。',
    validatingTitle: '正在校验托管规则与凭据',
    validatingDescription: '完整预检通过前不会恢复新任务接入。',
    stoppedTitle: '自动托管尚未启动',
    stoppedDescription: '显式开始后会先检查数据、模型、权限与微信窗口。'
  },
  runtime: { degradedReason: '自动接入受限，现有队列和待确认回复已保留。', failedReason: '自动托管启动失败，请检查设置后重试。', reviewSettings: '检查自动托管设置', validatingEmpty: '正在验证设置，队列保持可见。', startingEmpty: '正在启动监控，队列保持可见。', pausedEmpty: '已暂停领取新任务；现有队列上下文继续保留。', stoppingEmpty: '正在安全停止，未发送任务会按现有规则处理。', degradedEmpty: '队列已保留，等待自动接入恢复。' },
  metrics: { current: '当前', waiting: '等待', awaiting: '待确认' },
  groups: { current: '当前任务', waiting: '等待队列', awaiting: '等待你发送', recent: '最近结果' },
  taskStatus: { queued: '等待中', generating: '正在生成', waiting_to_send: '等待发送', awaiting_manual_send: '等待你发送', sending: '正在发送', sent: '已发送', delivery_unconfirmed: '发送结果未确认', cancelled: '已取消', generation_failed: '生成失败', send_failed: '发送失败' },
  taskType: 'AI 文本任务',
  taskReason: { manual_send_same_session: '因该会话手动发送而取消', manual_abandoned: '已放弃这条 AI 回复', hosting_disabled: '因自动托管停止而取消', critical_settings_changed: '因关键设置变更而取消', account_changed: '因账号切换而取消', user_cancelled: '已由用户取消', handoff: '需要人工接管，不会自动发送' } as Record<string, string>,
  actions: { cancel: '取消', retry: '重试', retrySend: '重试发送', recheck: '重新检查', inspectConversation: '打开会话检查', inspectHosting: '检查托管状态', confirmDelivery: '确认送达', confirmSentDiscard: '已确认已发送，丢弃旧草稿', save: '保存设置', saving: '正在保存…', close: '关闭设置', discard: '丢弃更改', continueEditing: '继续编辑', discardChanges: '放弃更改', confirmCritical: '停止托管并保存', send: '发送', inspectBeforeSend: '先检查会话', abandon: '放弃', test: '测试当前草稿', testing: '正在测试…', clearKey: '清除已保存 Key', refresh: '重试', clear: '清空', selectResults: '选择当前搜索结果', selectAll: '全选全部可托管联系人' },
  empty: { running: '自动托管运行中，正在等待新消息', stopped: '自动托管已停止' },
  composer: { label: '手动发送文本', placeholder: '输入文本；Enter 发送，Shift+Enter 换行', waiting: '等待当前发送完成…', failed: '发送失败，请保留文本后重试。', preserved: '输入已保留。Enter 发送，Shift+Enter 换行。', tooManyPending: '当前有多条消息正在等待发送结果。此草稿已保留，请稍后重试。', sentResolved: '已按你的确认丢弃旧草稿；此操作没有再次发送消息。', inspectedNotSent: '已检查且未发送', inspectedReady: '已确认会话中没有该消息。需要发送时，请再次单独点击发送或按 Enter。' },
  recovery: { conversationFocused: '已进入当前会话消息区域，请检查最新消息。', conversationUnavailable: '当前会话消息区域暂不可用，请返回聊天后检查。', settingsOpened: '已打开自动托管设置。', helpShown: '已显示安全恢复步骤。' },
  failure: {
    generationTimeout: { status: '生成超时', fact: 'Python 服务端未在生成时限内返回，但请求可能已经执行。', nextStep: '请先检查对应会话或稍后处理；不要直接重试，以免重复追加消息。', action: '打开会话检查' },
    generationAuth: { status: '凭据验证失败', fact: 'Python 服务端拒绝了当前 API Key。', nextStep: '请在托管设置中检查 API Key，确认连接成功后再重试。', action: '重试' },
    generationNetwork: { status: '服务连接失败', fact: 'OmniMindWeChat 无法从 Python 服务端取得有效回复。', nextStep: '请确认 Python 服务正在运行且 Base URL 可访问，再重试。', action: '重试' },
    generationMalformed: { status: '回复格式不兼容', fact: 'Python 服务端返回了 OmniMindWeChat 无法解析的结果。', nextStep: '请检查 Open Channel 版本与 Base URL，修复服务后再重试。', action: '重试' },
    generationEmpty: { status: '回复内容为空', fact: 'Python 服务端已返回，但没有可发送的文本。', nextStep: '请检查模型与客服规则，调整后再重试。', action: '重试' },
    generationHandoff: { status: '需要人工接管', fact: 'Python 服务端已判定本次对话不应自动回复。', nextStep: '请打开对应会话并由人工处理；系统不会自动重试。', action: '打开会话处理' },
    generationException: { status: '生成调用异常', fact: 'OmniMindWeChat 调用 Python 生成服务时发生内部异常。', nextStep: '请确认服务状态恢复后再重试。', action: '重试' },
    verificationBaseline: { status: '发送准备失败', fact: '无法读取发送前的微信消息记录。尚未执行微信发送。', nextStep: '确认 OmniMindWeChat 能读取当前会话后，再重新检查。', action: '重新检查' },
    accessibility: { status: '需要辅助功能权限', fact: 'OmniMindWeChat 没有控制微信所需的辅助功能权限。尚未发送。', nextStep: '打开权限中心的辅助功能卡片，并按提示恢复。', action: '查看授权步骤' },
    automationPermission: { status: '需要自动化权限', fact: 'OmniMindWeChat 没有控制微信界面所需的自动化权限。尚未发送。', nextStep: '打开权限中心的自动化卡片，并按提示恢复。', action: '查看授权步骤' },
    targetAmbiguous: { status: '无法确定目标', fact: '找到多个匹配会话，无法安全确定发送目标。尚未发送。', nextStep: '在微信中只保留并打开正确会话，再重试。', action: '查看目标检查步骤' },
    targetMismatch: { status: '目标不匹配', fact: '当前微信会话与任务目标不一致。尚未发送。', nextStep: '切换到正确会话并确认标题后，再重试。', action: '查看目标检查步骤' },
    wechatProcessUnavailable: { status: '微信未运行', fact: '当前未找到微信进程，尚未发送。', nextStep: '请打开微信并保持桌面版窗口可见，再重试。', action: '查看微信窗口步骤' },
    wechatWindowUnavailable: { status: '微信窗口不可用', fact: '微信当前没有可操作窗口，尚未发送。', nextStep: '请打开并解锁微信主窗口，再重试。', action: '查看微信窗口步骤' },
    searchOpenFailed: { status: '无法打开微信搜索', fact: '无法打开微信搜索界面，尚未发送。', nextStep: '请确认微信主窗口处于前台，再重试。', action: '查看微信窗口步骤' },
    searchFieldUnavailable: { status: '搜索框不可用', fact: '无法定位可用的微信搜索框，尚未发送。', nextStep: '请确认微信主窗口已显示搜索框，再重试。', action: '查看微信窗口步骤' },
    searchFieldAmbiguous: { status: '搜索框不唯一', fact: '找到多个微信搜索框，无法安全确定操作目标。尚未发送。', nextStep: '请关闭多余微信窗口并恢复标准布局，再重试。', action: '查看微信窗口步骤' },
    searchInputFailed: { status: '无法输入搜索条件', fact: '微信搜索框无法接收会话标题，尚未发送。', nextStep: '请手动点击搜索框并确认可输入，再重试。', action: '查看微信窗口步骤' },
    searchResultClickFailed: { status: '无法打开目标会话', fact: '找到目标会话但点击打开失败，尚未发送。', nextStep: '请在微信中手动打开目标会话并保持前台，再重试。', action: '查看微信窗口步骤' },
    inputUnavailable: { status: '输入区不可用', fact: '无法定位可用的微信输入框。尚未发送。', nextStep: '确认微信窗口已解锁且会话输入区可用。', action: '查看窗口检查步骤' },
    inputClickFailed: { status: '无法聚焦输入框', fact: '已找到微信输入框，但点击聚焦失败。尚未发送。', nextStep: '请点击微信输入框确认可输入后，再重试。', action: '查看微信窗口步骤' },
    inputPasteFailed: { status: '无法粘贴回复', fact: '无法将回复粘贴到微信输入框，尚未发送。', nextStep: '请确认微信输入框可编辑且剪贴板可用，再重试。', action: '查看微信窗口步骤' },
    inputSubmitFailed: { status: '无法提交消息', fact: '微信输入框未能提交消息，尚未发送。', nextStep: '请确认输入框仍处于会话中，再检查后决定是否重试。', action: '查看微信窗口步骤' },
    automationTimeout: { status: '自动化超时', fact: '自动化操作超时，发送结果无法确认。', nextStep: '请先检查微信会话；不要直接重试，以免重复发送。', action: '打开会话检查' },
    deliveryUnconfirmed: { status: '发送结果未确认', fact: '发送动作可能已执行，但消息记录尚未确认。', nextStep: '请先检查微信会话；确认未发送后再决定是否重发。', action: '打开会话检查' },
    unknown: { status: '发送状态未知', fact: '发送状态暂时无法确认。为安全起见，系统没有自动重试。', nextStep: '请检查微信会话和 OmniMindWeChat 状态；仍无法判断时暂停托管。', action: '打开会话检查' }
  },
  settings: {
    subtitle: '配置 OmniMind 托管规则、系统权限与安全策略',
    tabs: omniMindSettingsTabLabels,
    endpoint: 'Base URL', endpointHelp: '支持本机 HTTP 或远端 HTTPS；保存时规范化为 /api/v1/open。', endpointInvalid: '请输入本机 HTTP 或远端 HTTPS 地址，且不要包含凭据、查询或片段。',
    apiKey: '新 API Key', apiKeyHelp: '留空将保留已保存密钥；输入后保存会替换。', keyConfigured: '已安全配置', keyConfiguredHelp: '已保存内容不会回显', keyMissing: '未配置', keyMissingHelp: '输入新 Key 后安全保存', keySaved: 'API Key 已安全保存 · 内容不会回显', keyCleared: 'API Key 已清除', showDraft: '显示草稿', hideDraft: '隐藏草稿', clearKeyConfirm: '立即清除后自动托管将停止；当前密钥无法恢复。',
    connectionSuccess: '连接成功', connectionFailed: '连接测试失败，请检查地址、密钥和服务状态。', connectionErrors: { auth: '凭据验证失败，请检查 API Key。', network: '无法连接服务，请检查网络与地址。', timeout: '连接测试超时，请稍后重试。', incompatible: '目标服务响应不兼容，请确认 Open Channel 地址。' },
    selected: '指定联系人', all: '全部联系人', allRisk: '新出现的联系人也会自动纳入托管。', allConfirm: '我了解 AI 将响应所有符合条件的新入站文本消息',
    search: '搜索姓名、备注、微信号或会话 ID', filterAll: '全部', filterFriend: '私聊', filterGroup: '群聊', filterOfficial: '官方账号', selectedCount: '已选', unavailable: '当前会话不可用于新增托管', officialFiltered: '官方账号固定不回复', contactsLoading: '正在加载联系人与最近会话…', contactsEmpty: '未找到可托管会话', contactsError: '无法加载联系人与最近会话；已选范围仍会保留。', noResults: '没有匹配的会话', coverage: '预计覆盖', coverageUnknown: '当前无法估算覆盖数', boundedResults: '仅显示前 40 项，请继续搜索缩小范围', recentSession: '最近会话', noRecentSession: '无最近会话', removeFilteredOfficial: '历史范围中的官方账号不会触发托管，请移除：', confirmRemoveOfficial: '移除历史官方账号', scopeNoticeTitle: '托管回复规则', scopeNoticeOfficialExcluded: 'AI 仅接管个人联系人与微信群聊；公众号、服务号等官方账号固定不回复。', contactTypes: { private: '私聊', group: '群聊', official: '官方账号', other: '其他' },
    autoSend: 'AI 生成完成后自动发送', manualReview: 'AI 生成后等待你确认', batchWindow: '消息批处理窗口（秒）',
    criticalWarning: '运行中保存关键设置会停止托管并取消尚未实际发送的 AI 任务；等待你发送的回复会保留，保存后不会自动重启。', criticalChanges: { endpoint: '服务地址', key: 'API Key', scope: '托管范围' }, errorSummary: '请修正以下设置：', timingInvalid: '消息聚合窗口必须在允许范围内。', savedStopped: '设置已保存，自动托管未重启。', saved: '设置已保存，自动托管继续运行。', saveFailed: '设置保存失败，请重试。', discardTitle: '放弃未保存的更改？', discardConfirm: '有未保存的更改，确定丢弃吗？', migrationNotice: '旧版托管范围为空，请重新选择联系人或明确确认全部联系人。'
  },
  permissions: {
    title: 'macOS 权限',
    intro: 'OmniMindWeChat 需要两项独立的 macOS 权限。获得其中一项不代表另一项也已获得。',
    safeCheck: '检查权限只读取 macOS 返回的状态，不会激活微信、写入文本或发送消息。',
    loading: '正在读取',
    readFailed: '暂时无法读取权限状态，请稍后重新检查。',
    commandFailed: '权限操作未完成，请按当前卡片提示重试。',
    checking: '正在重新检查 macOS 权限。',
    checked: '权限状态已更新；不会自动开启托管或发送消息。',
    states: { not_requested: '尚未请求', unknown: '等待重新检查', granted: '已允许', denied: '未允许', unsupported: '当前系统不支持' },
    safePause: '所需权限不可用，自动接入保持安全暂停；队列、待确认回复和草稿均已保留。',
    actions: { request: '请求授权', openSettings: '打开系统设置', recheck: '重新检查', recover: '恢复权限' },
    requesting: { accessibility: '已请求 macOS 显示辅助功能提示；返回 OmniMindWeChat 后请重新检查。', automation: '已请求 macOS 显示自动化提示；返回 OmniMindWeChat 后请重新检查。' },
    opening: { accessibility: '正在 macOS 系统设置中管理辅助功能；返回 OmniMindWeChat 后请重新检查。', automation: '正在 macOS 系统设置中管理自动化；返回 OmniMindWeChat 后请重新检查。' },
    returned: { accessibility: '已返回 OmniMindWeChat。请重新检查辅助功能权限。', automation: '已返回 OmniMindWeChat。请重新检查自动化权限。' },
    cards: {
      accessibility: {
        title: '辅助功能', purpose: '让 OmniMindWeChat 识别当前微信窗口、会话和输入区域。',
        help: { not_requested: '点击“请求授权”后，仅由 macOS 显示系统提示。', unknown: '返回 OmniMindWeChat 后请主动重新检查。检查本身不会操作微信。', granted: 'macOS 已允许此权限。状态变化不会自动开启托管。', denied: 'macOS 未允许此权限。请打开系统设置完成选择，再返回重新检查。', unsupported: '当前系统不提供这项能力，自动托管保持关闭。' }
      },
      automation: {
        title: '自动化（Apple Events）', purpose: '让 OmniMindWeChat 仅向“系统事件”发送用于控制微信界面的 Apple Events。',
        help: { not_requested: '此权限独立于辅助功能。获得其中一项不代表另一项也已获得。', unknown: '返回 OmniMindWeChat 后请主动重新检查。此权限仍与辅助功能分开判断。', granted: 'macOS 已允许自动化权限；辅助功能仍须独立允许。', denied: '此权限独立于辅助功能。macOS 未允许自动化权限，请打开系统设置完成选择，再返回重新检查。', unsupported: '当前系统不提供这项能力，自动托管保持关闭。' }
      }
    }
  },
  queue: { generatedAt: '生成于', stale: '此后有新消息，请复核', staleConfirm: '这条回复生成后收到了新消息。再次发送将确认仍使用这条回复。', abandonConfirm: '放弃这条 AI 回复？此操作不会发送消息。', expand: '展开完整回复', collapse: '收起完整回复' },
  loading: '正在加载 AI 队列…', error: '队列状态加载失败，请重试。', taskCommandFailed: '任务操作失败，请重试。',
  skip: { sessions: '跳到会话列表', messages: '跳到消息区域', queue: '跳到 AI 队列' }
} as const

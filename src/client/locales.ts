/**
 * Copy dictionaries for the Nearby transfer panel.
 *
 * Every user-visible string on the panel lives here, in both shipped locales:
 * the panel renders no literal of its own, so adding a language is a dictionary
 * registration rather than a component change. Figures are not copy, so they are
 * formatted by `format.ts` against the active locale instead — a translated
 * string wraps a number, it never renders one.
 *
 * Keys are flat and the values are strings, because that is the shape the
 * locale runtime's dictionary contract requires; the dotted keys are the
 * grouping, and the `status.` / `fileStatus.` families are looked up by
 * concatenation from a state name the panel already has.
 *
 * Placeholders are `{name}`; the runtime substitutes them by name and leaves an
 * unknown name in place, so a template's contract is its own keys.
 *
 * @module dsh-local-send/client/locales
 */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '隔空传文件',
  heading: '隔空传文件',
  subtitle: '在同一网络内与其他设备互传文件',

  // This device
  thisDevice: '本机',
  rename: '改名',
  renamePlaceholder: '设备名称',
  save: '保存',
  cancel: '取消',
  serving: '可被接收',
  notServing: '未能监听端口，暂时收不到文件',
  addressLabel: '地址',
  noAddress: '未连接到网络',

  // Nearby
  nearby: '附近设备',
  rescan: '搜索',
  scanning: '正在搜索同一网络内的设备…',
  noPeers: '还没有发现其他设备',
  noPeersHint: '请确认对方也打开了 LocalSend 或本插件，并与本机连在同一个网络。',
  unreachable: '无法连接',
  scanFound: '找到 {count} 台设备',
  scanEmpty: '没有找到新设备',

  'deviceType.mobile': '手机',
  'deviceType.desktop': '电脑',
  'deviceType.web': '浏览器',
  'deviceType.headless': '终端',
  'deviceType.server': '服务器',
  'deviceType.unknown': '设备',

  // Sending
  dropToSend: '松手即发送',
  dropHint: '把文件拖到设备上即可发送',
  sendingTo: '正在发送到 {alias}',
  sendFiles: '选择文件发送',
  sendPaths: '按路径发送',
  pathsPlaceholder: '每行一个绝对路径',
  pathsSend: '发送这些文件',
  pathsEmpty: '请先填写至少一个文件路径',
  pathsInvalid: '这些路径不可用：{list}',

  // Incoming
  incomingTitle: '有设备想发送文件',
  incomingFrom: '{alias} 想发送 {count} 个文件',
  // Naming the file rather than repeating the count: the summary already said
  // there is one, so the useful thing to add is which one.
  incomingFromOne: '{alias} 想发送 {name}',
  incomingTotal: '共 {size}',
  accept: '接收',
  decline: '拒绝',

  // Transfers
  transfers: '传输记录',
  noTransfers: '还没有传输记录',
  noTransfersHint: '发送或接收文件后，记录会显示在这里。',
  directionIn: '来自',
  directionOut: '发往',
  filesCount: '{count} 个文件',
  filesCountOne: '1 个文件',
  // Shown only when a batch did not land whole, because that is the one case the
  // file count alone cannot describe.
  outcomeMixed: '{arrived} 个成功，{lost} 个未完成',

  'status.awaiting': '等待确认',
  'status.transferring': '传输中',
  'status.done': '已完成',
  'status.partial': '部分完成',
  'status.failed': '失败',
  'status.declined': '已拒绝',
  'status.canceled': '已取消',

  'fileStatus.offered': '待接收',
  'fileStatus.transferring': '传输中',
  'fileStatus.done': '已完成',
  'fileStatus.failed': '失败',
  'fileStatus.declined': '已拒绝',
  // Apart from `declined` on purpose: this one is the user's own choice, and
  // calling it "rejected" would blame the other device for it.
  'fileStatus.skipped': '未选择',

  // The point of the whole panel
  addToConversation: '加入会话',
  addedToConversation: '已加入输入框',
  addToConversationHint: '在输入框中插入该文件的引用，让当前会话可以读取它',
  noSession: '请先打开一个会话',
  reveal: '在文件夹中显示',
  savedTo: '已保存到 {path}',

  // The panel's own controls. `sendFiles` is the one that was written and never
  // wired, which is why the panel could only be fed by dragging.
  sendFilesHint: '选择本机文件，然后拖到下方设备上或直接发送',
  openInbox: '打开收件箱',
  inboxLabel: '收件箱',
  loading: '正在读取状态…',

  // Per-file receiving
  selectAll: '全选',
  selectNone: '全不选',
  selectedOf: '已选 {count}/{total}',
  acceptSelected: '接收所选（{count}）',
  noFileSelected: '请至少选择一个文件，或点「拒绝」',

  // Transfers the user can still act on
  stopTransfer: '停止',
  retryTransfer: '重试',
  retryTransferHint: '用同样的文件再发一次',

  // The right-click menu. It is this plugin's own menu rather than an item in
  // DSH's, because DSH has no seat for one — see `context-target.ts`.
  menuSendTo: '隔空发送到',
  menuNoPeers: '现在没有可发送的设备',
  menuFoldersUnsupported: '这个插件发送文件，不发送文件夹',
  menuCopyPath: '复制路径',
  menuCopied: '路径已复制',
  menuCopyFailed: '无法访问剪贴板',
  menuSending: '正在发送到 {alias}…',
  menuSent: '已发送到 {alias}',
  menuSendFailed: '发送失败：{message}',

  // The companion in the conversation header, and the banner above the composer.
  openPanel: '打开面板',
  buddyLabel: '隔空传文件',
  buddyOffered: '{count} 个文件等待确认',
  buddyOfferedOne: '{name} 等待确认',
  buddyBusy: '正在传输 · {percent}%',
  buddyDone: '刚刚完成一次传输',
  buddyFailed: '有一次传输没有完成',
  buddyIdleHint: '附近没有设备，也没有进行中的传输',
  buddyAdd: '加入会话',

  // Failure surfaces. The `detail` these carry is the operating system's own
  // message, deliberately left untranslated: it is what a search for the
  // problem will match.
  'warning.portUnavailable': '无法监听 {port} 端口，暂时收不到文件：{detail}',
  'warning.discoveryUnavailable': '设备发现已停用，看不到同一网络内的其他设备：{detail}',
  errorGeneric: '操作失败：{message}',
  errorOffline: '无法连接到插件后台，请确认插件已加载。',
  retry: '重试',
  dismiss: '知道了',
} as const

/** Simplified Chinese dictionary key set. */
export type LocalSendLocaleKey = keyof typeof zh

/** English dictionary. */
export const en: Record<LocalSendLocaleKey, string> = {
  nav: 'Nearby transfer',
  heading: 'Nearby transfer',
  subtitle: 'Send files to other devices on this network',

  thisDevice: 'This device',
  rename: 'Rename',
  renamePlaceholder: 'Device name',
  save: 'Save',
  cancel: 'Cancel',
  serving: 'Ready to receive',
  notServing: 'Not listening, so it cannot receive right now',
  addressLabel: 'Address',
  noAddress: 'Not connected to a network',

  nearby: 'Nearby',
  rescan: 'Search',
  scanning: 'Looking for devices on this network…',
  noPeers: 'No other devices yet',
  noPeersHint: 'Make sure the other device has LocalSend or this plugin open, on the same network as this machine.',
  unreachable: 'Not answering',
  scanFound: 'Found {count} devices',
  scanEmpty: 'No new devices found',

  'deviceType.mobile': 'Phone',
  'deviceType.desktop': 'Computer',
  'deviceType.web': 'Browser',
  'deviceType.headless': 'Terminal',
  'deviceType.server': 'Server',
  'deviceType.unknown': 'Device',

  dropToSend: 'Drop to send',
  dropHint: 'Drag files onto a device to send them',
  sendingTo: 'Sending to {alias}',
  sendFiles: 'Choose files',
  sendPaths: 'Send by path',
  pathsPlaceholder: 'One absolute path per line',
  pathsSend: 'Send these files',
  pathsEmpty: 'Enter at least one file path',
  pathsInvalid: 'These paths are unusable: {list}',

  incomingTitle: 'A device wants to send you files',
  incomingFrom: '{alias} wants to send {count} files',
  incomingFromOne: '{alias} wants to send {name}',
  incomingTotal: '{size} in total',
  accept: 'Receive',
  decline: 'Decline',

  transfers: 'Transfers',
  noTransfers: 'No transfers yet',
  noTransfersHint: 'Files you send or receive will be listed here.',
  directionIn: 'From',
  directionOut: 'To',
  filesCount: '{count} files',
  filesCountOne: '1 file',
  outcomeMixed: '{arrived} arrived, {lost} did not',

  'status.awaiting': 'Waiting for you',
  'status.transferring': 'Transferring',
  'status.done': 'Done',
  'status.partial': 'Partly done',
  'status.failed': 'Failed',
  'status.declined': 'Declined',
  'status.canceled': 'Canceled',

  'fileStatus.offered': 'Waiting',
  'fileStatus.transferring': 'Transferring',
  'fileStatus.done': 'Done',
  'fileStatus.failed': 'Failed',
  'fileStatus.declined': 'Declined',
  'fileStatus.skipped': 'Not selected',

  addToConversation: 'Add to conversation',
  addedToConversation: 'Added to the composer',
  addToConversationHint: 'Insert a reference to this file so the current conversation can read it',
  noSession: 'Open a conversation first',
  reveal: 'Show in folder',
  savedTo: 'Saved to {path}',

  sendFilesHint: 'Choose files on this machine, then drop them on a device or send them straight away',
  openInbox: 'Open the inbox',
  inboxLabel: 'Inbox',
  loading: 'Reading the current state…',

  selectAll: 'All',
  selectNone: 'None',
  selectedOf: '{count} of {total} selected',
  acceptSelected: 'Receive {count}',
  noFileSelected: 'Pick at least one file, or decline the offer',

  stopTransfer: 'Stop',
  retryTransfer: 'Send again',
  retryTransferHint: 'Send the same files again',

  menuSendTo: 'Send over the network to',
  menuNoPeers: 'No device is available to send to right now',
  menuFoldersUnsupported: 'This plugin sends files, not folders',
  menuCopyPath: 'Copy path',
  menuCopied: 'Path copied',
  menuCopyFailed: 'The clipboard is not available',
  menuSending: 'Sending to {alias}…',
  menuSent: 'Sent to {alias}',
  menuSendFailed: 'Sending failed: {message}',

  openPanel: 'Open the panel',
  buddyLabel: 'Nearby transfer',
  buddyOffered: '{count} files are waiting for you',
  buddyOfferedOne: '{name} is waiting for you',
  buddyBusy: 'Transferring · {percent}%',
  buddyDone: 'A transfer just finished',
  buddyFailed: 'A transfer did not finish',
  buddyIdleHint: 'No devices nearby and nothing in flight',
  buddyAdd: 'Add to conversation',

  'warning.portUnavailable': 'Cannot listen on port {port}, so files cannot arrive right now: {detail}',
  'warning.discoveryUnavailable': 'Device discovery is off, so other devices on this network cannot be seen: {detail}',
  errorGeneric: 'That did not work: {message}',
  errorOffline: 'Cannot reach the plugin host. Check that the plugin is loaded.',
  retry: 'Retry',
  dismiss: 'Dismiss',
}

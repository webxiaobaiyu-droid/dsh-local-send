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
export declare const zh: {
    readonly nav: "隔空传文件";
    readonly heading: "隔空传文件";
    readonly subtitle: "在同一网络内与其他设备互传文件";
    readonly thisDevice: "本机";
    readonly rename: "改名";
    readonly renamePlaceholder: "设备名称";
    readonly save: "保存";
    readonly cancel: "取消";
    readonly serving: "可被接收";
    readonly notServing: "未能监听端口，暂时收不到文件";
    readonly addressLabel: "地址";
    readonly noAddress: "未连接到网络";
    readonly nearby: "附近设备";
    readonly rescan: "搜索";
    readonly scanning: "正在搜索同一网络内的设备…";
    readonly noPeers: "还没有发现其他设备";
    readonly noPeersHint: "请确认对方也打开了 LocalSend 或本插件，并与本机连在同一个网络。";
    readonly unreachable: "无法连接";
    readonly scanFound: "找到 {count} 台设备";
    readonly scanEmpty: "没有找到新设备";
    readonly 'deviceType.mobile': "手机";
    readonly 'deviceType.desktop': "电脑";
    readonly 'deviceType.web': "浏览器";
    readonly 'deviceType.headless': "终端";
    readonly 'deviceType.server': "服务器";
    readonly 'deviceType.unknown': "设备";
    readonly dropToSend: "松手即发送";
    readonly dropHint: "把文件拖到设备上即可发送";
    readonly sendingTo: "正在发送到 {alias}";
    readonly sendFiles: "选择文件发送";
    readonly sendPaths: "按路径发送";
    readonly pathsPlaceholder: "每行一个绝对路径";
    readonly pathsSend: "发送这些文件";
    readonly pathsEmpty: "请先填写至少一个文件路径";
    readonly pathsInvalid: "这些路径不可用：{list}";
    readonly incomingTitle: "有设备想发送文件";
    readonly incomingFrom: "{alias} 想发送 {count} 个文件";
    readonly incomingFromOne: "{alias} 想发送 1 个文件";
    readonly incomingTotal: "共 {size}";
    readonly accept: "接收";
    readonly decline: "拒绝";
    readonly transfers: "传输记录";
    readonly noTransfers: "还没有传输记录";
    readonly noTransfersHint: "发送或接收文件后，记录会显示在这里。";
    readonly directionIn: "来自";
    readonly directionOut: "发往";
    readonly filesCount: "{count} 个文件";
    readonly filesCountOne: "1 个文件";
    readonly 'status.awaiting': "等待确认";
    readonly 'status.transferring': "传输中";
    readonly 'status.done': "已完成";
    readonly 'status.partial': "部分完成";
    readonly 'status.failed': "失败";
    readonly 'status.declined': "已拒绝";
    readonly 'status.canceled': "已取消";
    readonly 'fileStatus.offered': "待接收";
    readonly 'fileStatus.transferring': "传输中";
    readonly 'fileStatus.done': "已完成";
    readonly 'fileStatus.failed': "失败";
    readonly 'fileStatus.declined': "已拒绝";
    readonly addToConversation: "加入会话";
    readonly addedToConversation: "已加入输入框";
    readonly addToConversationHint: "在输入框中插入该文件的引用，让当前会话可以读取它";
    readonly noSession: "请先打开一个会话";
    readonly reveal: "在文件夹中显示";
    readonly savedTo: "已保存到 {path}";
    readonly errorGeneric: "操作失败：{message}";
    readonly errorOffline: "无法连接到插件后台，请确认插件已加载。";
    readonly retry: "重试";
    readonly dismiss: "知道了";
};
/** Simplified Chinese dictionary key set. */
export type LocalSendLocaleKey = keyof typeof zh;
/** English dictionary. */
export declare const en: Record<LocalSendLocaleKey, string>;

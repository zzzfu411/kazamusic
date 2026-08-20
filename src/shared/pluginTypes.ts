export const PLUGIN_STATUS_LABEL = {
  not_installed: "未安装",
  active: "已启用",
  disabled: "已禁用",
  expired: "已过期",
  superseded: "需更新",
  invalid: "无效",
  check_failed: "检查失败",
} as const;

export type PluginStatus = keyof typeof PLUGIN_STATUS_LABEL;

export function pluginStatusHint(status: string): string {
  switch (status) {
    case "not_installed":
      return "导入官方在线播放插件后，方可播放在线音乐；无需登录 KAZAM 账号。";
    case "active":
      return "插件正常，可播放在线音乐。";
    case "disabled":
      return "插件已被停用，请重新获取或联系管理员。";
    case "expired":
      return "插件已过期，请重新下载并导入。";
    case "superseded":
      return "插件已更新，请下载新版本并重新导入。";
    case "invalid":
      return "插件文件无效，请重新导入。";
    case "check_failed":
      return "无法验证插件状态，请检查网络或在插件页手动检查。";
    default:
      return "";
  }
}

export function pluginPlayBlockMessage(status: string): string {
  switch (status) {
    case "not_installed":
      return "在线播放需要安装插件，请前往 设置 → 插件 导入";
    case "disabled":
      return "在线播放插件已停用，请在 设置 → 插件 中处理";
    case "expired":
      return "在线播放插件已过期，请重新下载并导入";
    case "superseded":
      return "在线播放插件已更新，请重新下载并导入";
    case "invalid":
    case "check_failed":
      return "在线播放插件不可用，请在 设置 → 插件 中检查";
    default:
      return "在线播放插件未启用";
  }
}

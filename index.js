/**
 * dsh-copy-as — Host loader entry.
 *
 * 本插件全部逻辑在浏览器半边（`./client`）：它贡献一个右键菜单子菜单和一个
 * 消息操作栏按钮，把正文按选用格式写进剪贴板。Host 侧不需要任何服务，
 * 这里只提供一个空的 Cordis 插件，让 Loader 有一行可加载的宿主入口。
 */

export const name = "dsh-copy-as";

/** Host 侧不需要任何服务。 */
export const inject = [];

/**
 * 空实现。
 * @param {unknown} _ctx - Host 插件上下文（未使用）。
 */
export function apply(_ctx) {}

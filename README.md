# dsh-note-wall · 便签墙

一个带**左侧栏入口**的 DSH 插件：灵感随手记下，留在柔和的一面便签墙上，Agent 也能读写同一面墙。

## 它做什么

- **侧边栏入口**：左侧栏「便签墙」图标，点开即整页便签墙（`sidebar.panellist` + `main`）。
- **随手写**：顶部大号输入卡，`⌘/Ctrl + Enter` 或点「添加到墙上」即可。
- **自动保存**：输入中的草稿自动存在浏览器本地，切走再回来还在；已上墙的便签存在磁盘。
- **六种颜色**：奶油黄 / 玫瑰粉 / 天蓝 / 薄荷绿 / 丁香紫 / 米白，点圆点即换。
- **一面墙**：窗口 < 1120px 时 3 列共 6 格，≥ 1120px 时 4 列共 8 格，空位用柔和占位卡补齐。
- **卡片固定形状，不随内容变形**：网格行高钉死 168px，卡片 `height:100%` + `min-height:0`，正文最多 4 行后省略。内容再长也改变不了卡片高度——这条是为了修掉「长文把卡片顶成正方形」。
- **点卡片读全文**：点任意便签打开浮层，完整正文（保留换行与缩进）在这里读；浮层里可直接编辑或删除，`Esc` / 点遮罩 / 「关闭」退出，点遮罩只认空白处，拖选文字不会误关。
- **贴上去的手感**：新便签从上方落下、过冲回弹、收尾静止，落定后柔光扫过（落地 1.1s、柔光 1s + 0.24s 延迟）；系统开启「减少动态效果」时自动关闭。动画时长与清理计时器共用同一组常量（`LAND_MS` / `SHEEN_MS` / `SHEEN_DELAY_MS` → `LANDING_MS`），测试会核对 CSS 与 JS 是否一致。
- **搜索与计数**：右上角搜索框按内容过滤，旁边显示便签总数。
- **编辑与撤销删除**：点任意便签进入编辑；删除后底部有「撤销」。
- **Agent 也能用**：注册了 `note_wall` 工具，模型可以读墙、贴便签、改便签、删便签。

## 结构

```
dsh-note-wall/
├── index.js            # Host 半：存储、HTTP API、note_wall 工具
├── client.js           # Client 半：侧边栏图标 + 便签墙页面
├── cordis.patch.yml    # 组合包层：插入 note-wall 行
├── locale/{en,zh}.json # 插件管理页的标题与描述
├── icon.svg            # 插件图标
└── test/               # 宿主与客户端的回归测试
```

### Host 半（`index.js`）

所有操作收敛到一组方法（`list` / `add` / `update` / `remove`），HTTP 路由和 Agent
工具是同一组方法的两个调用者，不存在两份逻辑。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-note-wall/api/notes` | 列出便签（`?q=` 过滤） |
| `POST` | `/dsh-note-wall/api/notes` | 新建 `{ text, color?, span?, height? }` |
| `POST` | `/dsh-note-wall/api/notes/update` | 修改 `{ id, text?, color?, span?, height? }` |
| `POST` | `/dsh-note-wall/api/notes/delete` | 删除 `{ id }` |

存储默认落在 `$DSH_HOME/note-wall/notes.json`，写入走「临时文件 + rename」并串行化，
不会留下半截文件。落盘失败会回滚内存并回报错误，界面不会显示一张磁盘上并不存在的便签；
存储文件损坏时以空墙启动，下一次写入会重建它。

### 卡片形状（`span` / `height`）

| 字段 | 范围 | 说明 |
| --- | --- | --- |
| `span` | 1–4 | 跨几列。墙是 3/4 列网格，自由像素宽会溢出自己那一格并压住邻居。 |
| `height` | 0 或 132–1200 | 像素高度；`0` = 默认行高。 |

> 这两个字段目前**没有任何界面入口**——拖拽拉伸按要求已移除，卡片一律用固定行高。
> 字段保留是为了老数据能读、以及 Agent 通过 `note_wall` 工具仍可显式指定形状；
> 两者在 Host 侧都会夹取范围，尺寸变化不会动 `updatedAt`，所以不会把便签顶到墙首。

### Agent 工具 `note_wall`

| action | 参数 | 说明 |
| --- | --- | --- |
| `list` | `query?` | 读墙，可按内容过滤 |
| `add` | `text`, `color?`, `span?`, `height?` | 贴一张新便签 |
| `update` | `id`, `text?`, `color?`, `span?`, `height?` | 改内容、颜色或卡片形状 |
| `delete` | `id` | 删一张 |

## 配置

`cordis.patch.yml` 的行 config：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `storagePath` | `''` | 便签存储文件；留空 = `$DSH_HOME/note-wall/notes.json` |
| `maxNotes` | `500` | 便签总数上限（1–5000） |

## 安装

```powershell
# 在 DSH 会话里由 Agent 执行 plugin_manager install_bundle，
# target 为本目录的绝对路径。
```

或手动在 profile 的 `cordis.patch.yml` 增加行后重启：

```yaml
- insert:
    - id: note-wall
      name: dsh-note-wall
      config: {}
```

## 测试

```powershell
node test/host.test.mjs         # 存储、路由、note_wall 工具
node test/host-failure.test.mjs # 损坏文件、写失败回滚、写链恢复
node test/client.test.mjs       # 模块 id、语言包、样式、主题、两个 slot
```

客户端的**渲染**需要在浏览器里看：`test/client.test.mjs` 只验证注册事实，不模拟 React 或 DOM。
## 主题与排版

界面骨架只使用 `--dsw-alias-*` 主题 token；便签底色是作品本身（参考图的马卡龙色），
因此用插件自己的 `--nw-card-*` 变量，并按 `data-scheme` 提供深色版本。

便签正文为 15.5px / 24px 行高、字重 500，比宿主正文（13px）更醒目——它是要被「读」的内容，
不是界面标签。列数由 CSS 断点决定，补位数量由同一断点计算（`(min-width:1120px)` → 8 格，
否则 6 格），两处不会各说各话。

## 卡片形状固定，全文在浮层里读

**卡片高度不由内容决定**：`grid-auto-rows:168px` 把行高钉死，卡片 `height:100%` +
`min-height:0`，正文 `-webkit-line-clamp:4` + `overflow:hidden`。

这条是修一个真实 bug：早前只写 `align-items:stretch` 时，行高由**同排最高那张卡的内容**
决定；一段 7 行的长文在 3 列宽卡上正好把行高顶到接近卡宽（960px/3 ≈ 311px），
整排看起来就是**正方形**。把行高钉死后，卡宽/高比稳定在 1.4–1.85，内容再也改不了它。

读全文走**浮层**而不是把卡片撑大：`position:fixed` 遮罩 + 600px 对话框，正文
`white-space:pre-wrap` 保留代码缩进，`overflow:auto` + `max-height:80vh` 保证按钮不被顶出屏幕。
浮层支持 `Esc`、点空白遮罩关闭（判 `target === currentTarget`，拖选文字不会误关）、
打开时焦点移入对话框。

**为什么不做拖拽拉伸**：卡片宽度是网格列宽算出来的，自由像素宽会溢出自己那一格并压住邻居；
而「拖宽 -> 内容区变大 -> 又想拖高」这条链最终还是会和「整面墙等高」冲突。浮层把
「看全文」这件事从布局里拿出来，两边的约束就都不需要让步。

## 动画为什么用 `linear`

CSS 的 `animation-timing-function` 是**逐段生效**的：一条 ease 曲线配 5 个关键帧，
速度会在每个关键帧归零、再在下一段重启，卡片看上去就是「一格一格跳」。

所以落地动画改用**阻尼弹簧的密集采样**（20 个关键帧）+ `linear`：缓动已经烘焙进采样点，
速度天然连续。弹簧参数取 `d(1)=0`（`cos 2.5π = 0`），落点正好静止，收尾不会硬切。
阴影只在卡片高于墙面时存在（`max(0, d)`），落地后不再「消失又出现」。

改这组数值时，`LAND_MS` / `SHEEN_MS` / `SHEEN_DELAY_MS` 必须同步；测试会核对
CSS 与 JS 是否一致，并检查轨迹的连续性（起点在上方、有过冲、终点恰好为 0）。

## 许可

MIT

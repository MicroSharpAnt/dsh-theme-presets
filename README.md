# dsh-theme-presets

DSH Web GUI 的主题预设插件：在内置的 **浅色 / 深色 / 跟随系统** 之外，再叠一层**配色家族**。

## 安装

在 DSH 的插件安装界面里填：

```
https://github.com/MicroSharpAnt/dsh-theme-presets.git
```

也可以用 `github:MicroSharpAnt/dsh-theme-presets` 或
`git+ssh://git@github.com/MicroSharpAnt/dsh-theme-presets.git`。

**不要用 `git@github.com:...` 这种 scp 语法**：DSH 的预检会放行，但 pnpm 把它按
`name@range` 拆成「包名 `git` + 版本 `github.com:...`」，于是只装出一个悬空的
`node_modules/git` 软链，日志特征是 `added 0`，实际什么都没装上。

安装后**无需构建**：浏览器端产物 `lib/client.js` 随仓库提交，本包也没有任何运行时依赖。

> 仓库已从 `DSH-simple-theme-plugin` 更名为 `dsh-theme-presets`。旧地址仍会重定向，
> 但建议直接用上面的新地址。

### 从本地目录安装（开发时）

插件安装界面也接受绝对路径，指向工作副本即可，改完代码后重启 dsh web 生效。

## 用法

**设置 → 通用 → 主题预设**，点一个色块。

- 预设只决定**配色家族**，明暗仍由上一行的「外观」控制，两者正交。
  选了 Nord 之后，「浅色」= Snow Storm，「深色」= Polar Night，
  「跟随系统」则跟着系统在两者之间切。
- 每个色块显示当前明暗模式下该预设的底色 / 强调色 / 正文色，会随「外观」一起变。
- **默认** = DSH 自带配色，不做任何覆盖。
- 选择写进当前 Web profile 的 `cordis.patch.yml` 中 `theme-presets.config.preset`，
  跨刷新、跨重启保留。

## 八个预设

| id | 名称 | 浅色变体 | 深色变体 |
| --- | --- | --- | --- |
| `nord` | Nord | Snow Storm | Polar Night |
| `dracula` | Dracula | Alucard | Dracula |
| `catppuccin` | Catppuccin | Latte | Mocha |
| `tokyonight` | Tokyo Night | Day | Night |
| `onedark` | One Dark | One Light | One Dark |
| `gruvbox` | Gruvbox | Light | Dark |
| `solarized` | Solarized | Light | Dark |
| `github` | GitHub | Light | Dark |

配色取自各主题自己发布的调色板，不是凭印象配的近似值。每个主题的 15 个语义锚点
（底色 / 表面 / 文字 / 边框 / 强调 / 四种状态）定义在 `presets.mjs`，其余 92 个
`--dsw-alias-*` token 由统一的 `deriveTokens()` 用 `color-mix()` 从这些锚点派生。

## 改配色

`presets.mjs` 是唯一数据源。

1. 改 `PRESETS` 里某个预设的 `light` / `dark` 锚点（各 15 个颜色），或整段新增一个预设；
2. `npm run build` 重新生成 `lib/client.js`；
3. 浏览器刷新。

只调配色不需要重启；改了 `host.js` 或 `src/plugin.mjs` 则要重启 dsh web。

## 测试

```sh
npm test            # 进程外的五个套件，不需要运行中的 dsh
node e2e-test.mjs   # 可选：真实浏览器端到端（22 项），需要运行中的 dsh web + 本机 Chrome
```

`e2e-test.mjs` 结束时会恢复进入时的预设，不会改掉你的选择；
dsh 检出不在默认位置时用 `DSH_CHECKOUT=/path/to/dsh` 覆盖。

## 实现细节

首屏无闪烁的三层接管机制、宿主端加载的三条约束、为什么自带一份 Config schema，
以及各测试套件的覆盖范围：见 **[docs/internals.md](docs/internals.md)**。

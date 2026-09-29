# 实现细节

面向要改这个插件的人。安装、用法与配色改动见 [README](../README.md)。

## 工作原理

三层按时间顺序接管同一批 `--dsw-alias-*`，交接处不跳变：

1. **首屏——宿主端注入（无闪烁）**
   `host.js` → `src/plugin.mjs` 监听 `webserver/index-inject`，在每次 index 响应里加两条：

   - head 一条 CSS：
     `html body[data-dsh-theme-preset="nord"]{…浅色 token…}`
     `html body[data-dsh-theme-preset="nord"][data-ds-dark-theme]{…深色 token…}`
   - body 一个脚本：给 `<body>` 打上 `data-dsh-theme-preset="nord"`

   两条规则都写成 `(0,1,2)` 特异性，压过基础样式表的
   `body[data-ds-dark-theme]`，同时**刻意不用 `!important`**——那会连第 2 层
   的 inline 覆盖一起挡住。body 注入行紧跟 `<body>` 开标签、按激活顺序排列，
   所以 ui-theme 的 boot 脚本（设 `data-ds-dark-theme`）先跑，随后深色规则生效；
   属性一旦打上，CSS 是回溯匹配的，两个脚本谁先谁后都不影响结果。

2. **接管**
   浏览器端 `lib/client.js` 加载后调 `ctx.theme.overrideTokens()`，
   ui-layout 的 presenter 把这些 token 写成 **inline 自定义属性**（优先级高于
   任何样式表），同时移掉第 1 层那个属性。这一步等配置解析完才做：
   在 `loading` 期间先按兵不动，否则会先把预设抹掉、等值到了再刷回来，
   那正是这个插件要消灭的闪烁。

3. **切换**
   只替换 override 层——不重载页面、不重新注册主题。
   上游的 `setTheme('<第三方 id>')` 是不持久化的（`isThemePreference` 为 false），
   所以预设走 override 通道而不是注册新主题 id。

第 1、2 层的值同出 `presets.mjs` 一份数据，所以交接处像素级一致。

## 宿主端加载

`Config` 由宿主入口同步导出，DSH Settings 从活动插件的 schema 生成表单。
插件读 `config.preset.get()`，因此修改选择后，下一次首屏注入也能读到新值。

**`dsh.bundle.patch` 声明不能省**：安装器只把声明了 `dsh.bundle` 的包当作 profile 层，
其余的按普通依赖装入——那样宿主半不会加载，而客户端半仍会因 `dsh.client` 被发现，
症状是设置行照常显示、点击也有反应，但首屏注入不生效、选择也存不下来。
`verify-contract.mjs` 里有断言钉住这一点。

改宿主端代码时会撞上三条加载机制造成的约束：

1. **同路径的模块会被 ESM 缓存。**
   cordis 重载时按绝对路径 `import()` 插件，而 Node 对重复的 specifier 直接返回
   缓存模块——所以**改了被静态导入的源码，进程里跑的仍然是旧代码**。
   本插件只有 `presets.mjs` 走 mtime 动态载入；改 `host.js` 或 `src/plugin.mjs` 要重启。

2. **patch 条目按 `id` 做 diff，改 `name` 不生效。**
   只改注释不触发重载；改 `name` 也**不会**换用新路径，实测仍旧加载缓存里的旧模块。
   要让条目真正卸载重装，得先把整个 `- insert:` 块删掉保存，再加回来保存。

3. **`package.json` 的 `dsh.client.inject` 只在进程启动时解析。**
   HMR 只重建 bundle、不重读 package.json（`graphRow(id, rev, record.meta)`
   沿用旧 meta），所以改了那几项要重启才更新。
   它只影响加载顺序、不影响功能：真正的依赖由 bundle 里 `exports.inject`
   的服务名（`theme` / `slots` / `locale` / `configForms` / `remote`）保证，
   cordis 会等到服务出现才 apply。

## 为什么自带一份 schema

`@deepseek-ai/schemastery` 是 DSH 工作区私有包（内部一律 `workspace:^` 引用，
未发布到任何 registry），**从 git 安装的插件无法依赖它**，所以 `src/schema.mjs`
自己实现了所需的 Standard Schema 校验接口和 `{uid, refs}` 描述格式，
无需安装时构建或新增依赖。

有一个必须注意的细节：`toJSON()` 的输出**必须与 schemastery 的引用表格式结构一致**
（`{uid, refs}`，其中 `union.list` 放的是**数字引用**而不是字面量），因为客户端会
拿它去 `new Schema(envelope)` 重新水合。早期版本输出的是等价的扁平对象，
结构上"看起来更清楚"，但**在客户端解码时被拒**，症状就是静默失效。
`schema-test.mjs` 因此断言的是引用表结构本身，而不是它的语义。

第二个同类陷阱：**fallback 必须是 union 的一个分支**。schemastery 的 union 只接受
自己 `list` 里的 const，`meta.default` 不参与校验。所以当 `PRESET_IDS` 不含
`default`、而 `meta.default` 恰好是 `default` 时，客户端水合描述符后校验
`{preset: "default"}` 会直接抛错。Host 那边照样接受写入并落盘，客户端却丢弃这一段、
把行回滚到上一个预设——症状就是"点『默认』闪一下就跳回原主题"，而 profile 里其实
已经存了 `default`，两边从此不一致。根因是 `PRESET_IDS`
（`presets.mjs`，只含 11 个配色家族）与 `DEFAULT_PRESET_ID` 是两回事，而 fallback
作为可存储值也必须能被校验接受。现在 `createPresetSchema()` 会自行把 fallback 并进
分支表，`schema-test.mjs` 则改成使用 Host 真实传入的 id 列表、并真的用 schemastery
水合一次来钉住这一点——早先这组测试自己手写了一份含 `default` 的 id 列表，
恰好掩盖了这个缺陷。

## 测试

```sh
node build-client.mjs   # 或 npm run build
npm test                # 五个套件，不需要运行中的 dsh
node e2e-test.mjs       # 可选：真实浏览器里的端到端验证，22 项
```

| 套件 | 覆盖 |
| --- | --- |
| `verify-contract.mjs` (15) | 复现 dsh 的客户端发现链路：包名、`dsh.client`、`./client` 导出形状、bundle id 与 package name 一致 |
| `schema-test.mjs` | Config 校验、未知 id 回退、volatile 描述格式，以及用真实 schemastery 重新水合描述符并校验各段取值 |
| `self-test.mjs` (19) | 浏览器端逻辑：接管时机（loading 期不接管）、92 token 覆盖、切换与持久化、未知 id 回退 |
| `host-test.mjs` | 宿主端：Config 校验、实时切换和首屏注入 |
| `bundle-test.mjs` (11) | 执行**真实产物** `lib/client.js`：注册形状、只 require `react`、导出面、内联数据完整 |
| `e2e-test.mjs` (22) | 真实浏览器（playwright + 本机 Chrome）：设置行出现、12 个选项、切换后浏览器端接管、持久化、重载后首屏层先绘制、两层取值一致、无 console 报错 |

前五个套件都在进程外跑，只有 `e2e-test.mjs` 会连真实 GUI —— 因此它**不在
`npm test` 里**：需要**运行中的 `dsh web`**（token 从 `<checkout>/.dsh-build` 下
最新的 service log 读——`dsh web` 每次启动都会轮换它）、本机 Google Chrome，以及
dsh 检出里的 playwright。它在结束时会**恢复进入时的那个预设**，所以不会改掉你的选择。
dsh 检出不在默认位置时用 `DSH_CHECKOUT=/path/to/dsh` 覆盖。

`schema-test.mjs` 的客户端水合检查要读检出里的 `vendor/schemastery`：找不到就跳过那一条
（其余断言照跑），查找顺序是 `DSH_CHECKOUT`、`~/git/deepseek-harness`、包目录的兄弟目录。

## 目录

```
host.js             宿主入口：导出 Config，接线首屏注入
src/plugin.mjs      宿主端实现：注入行的构造
src/schema.mjs      自带的 Config schema（无外部依赖）
presets.mjs         唯一数据源：11 个预设的锚点色 + deriveTokens()
src/runtime.mjs     浏览器端源码（自包含函数，构建时内联进 bundle）
build-client.mjs    生成 lib/client.js
lib/client.js       构建产物，随仓库提交（浏览器实际加载的东西）
lib/client.d.ts     产物类型声明
e2e-test.mjs        可选：真实浏览器端到端验证
verify-contract.mjs / schema-test.mjs / self-test.mjs / host-test.mjs / bundle-test.mjs
                    进程外的测试套件
```

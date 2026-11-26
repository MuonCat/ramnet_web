# RAM-Net 论文展示页

请通过静态 HTTP 服务器访问 `index.html`（也支持部署到子目录）。页面会直接读取 `data/palette.json`；`file://` 打开方式不再支持。全站只有 HTML、CSS、JavaScript 与本地数据文件，无构建步骤、第三方依赖或在线字体；资源路径均为相对路径。

## 文件结构

```text
index.html                      英文论文正文、章节结构、公式和动画插入位置
assets/
  site.css                      页面排版、配色、响应式布局
  palette.js                    读取颜色 JSON，并为 CSS 与动画提供同一套色值和插值函数
  site.js                       共享正文宽度、首屏高度预算与动图尺寸适配
  section-scroll.js             章节定位、吸附、阅读进度、自动播放与尾页尺寸
  experiments.js                读取实验 JSON、生成三张表、计算列排名与切换页签
  embed.css                     动画的统一展示样式与播放器样式
  animation-runtime.js          独立页与嵌入页共用的主题、交互模式和帧调度
  exhibit-host.js              主页面内的 Shadow DOM 动画容器
  exhibit-markup.js            从十个动画 HTML 生成的静态模板
  stage-timeline.js             sec2 / sec6 共用的带阶段名称的非均匀时间轴
  favicon.svg                   本地站点图标
animations/
  attn_cmp.{html,css,js}         注意力与存储方式对比
  ramnet_arch.{html,css,js}      RAM-Net 架构及分阶段播放器
  product_softmax.{html,css,js}  五种视图、Top-K 和分布交互
  cape.{html,css,js}             CAPE 开关、分布拖动与位置响应
  gsu.{html,css,js}              质量、门控、向量的直接交互
  cal_pipeline.{html,css,js}     CUDA 执行流水线及分阶段播放器
  niah_probe.{html,js}           第 8 章探针动画
  head_probe.{html,js}           第 9 章探针动画
  slot_usage.{html,css,js}       第 10 章访问累积、排序与对数正态排名参考曲线
  hardware.{html,css,js}         第 11 章整数寻址、独立执行与片上 SRAM 的硬件概念动画
data/experiments.json           实验结果唯一的 JSON 数据源
data/palette.json               固定色值、色系、透明度和渐变区间的配置
data/experiments.js             本地直接打开时使用的数据快照
data/probes/
  *.json                         原始 trace 数据
  *.js                           供页面直接使用的静态数据
tools/sync_static.py             同步动画模板与 file:// 数据快照
tools/check_site.py              Chrome 中检查嵌入页、独立页与结果表
tools/prepare_slot_usage.ps1      从外部逐 token 记录生成槽位访问计数 JSON
```

动画保留独立页面和共享的交互脚本，主页面使用 `assets/exhibit-markup.js` 中的静态 HTML 模板。`animations/*.html` 是模板源；修改结构或 JSON 数据后，运行 `python tools/sync_static.py` 更新生成文件，使用 `python tools/sync_static.py --check` 检查是否同步。部署时无需运行脚本。

颜色从 `data/palette.json` 读取：`colors` 的键是稳定标识（初始色值），值是当前实际色值；同一个键在 CSS、SVG 和 Canvas 中共用。`tones` 将色系的主色和文字色关联到这些键；`ranges` 用 `start`、`end`、`scaling` 定义连续变化，其中 `linear`、`sqrt` 和 `sqrt-after` 分别表示线性、先对进度开方、插值后开方。修改 JSON 后直接刷新 HTTP 页面即可看到变化，颜色报告也读取同一份配置。

主页面使用 Shadow DOM 将十个动画直接嵌入正文中的 div，隔离变量与样式；不使用 iframe。独立预览和正文嵌入共用 `assets/animation-runtime.js`，由它管理主题、窄屏交互和帧调度。第 8、9 章的 JSON 同时保存为生成的静态 JavaScript 数据文件，页面直接读取，无运行时数据请求。离开可视区的动画停止逐帧绘制，并尊重系统的减少动态效果设置。

第 10 章通过相对路径读取 `data/probes/slot_usage.json`。数据保留 11 个 head × 6 组语料的完整逐 token 事件，读写各 Top-8；CAPE 地址先撤销位置平移。地址与 token ID 采用 gzip + base64 无损保存，由浏览器原生 `DecompressionStream` 解码。播放时按顺序处理每个 token 的 16 次访问，每次加 1 并更新排名；即使两个显示帧之间跨过多个 token，也会逐个处理，不抽样、不聚合、不插值计数。对数正态排名参考曲线使用最终访问计数拟合离散程度 σ，位置参数由总量归一化吸收；播放时仅缩放曲线总量，不参与生成访问次数。可用 `powershell -File tools/prepare_slot_usage.ps1 -SourcePath <source-json>` 重新清洗原始数据；此脚本无需额外依赖。章节支持中英文、共享布局、吸附与自动播放。

第 11 章以概念时序展示前端解码整数地址、不同槽位独立执行、同一槽位保序，以及热点数据在片上 SRAM 中复用。动画为 SVG，共用颜色配置、阶段进度条和播放图标；随全局紧凑模式切换横向与纵向布局。

论文页面以视口比例和第 3 节可用主图宽度决定紧凑模式。竖屏直接采用紧凑排版，横屏在主图过窄时切换。紧凑模式保留页签、Top-K、播放和阶段切换，停用权重、门控等精细调整。各节动图按标题下方的可用高度等比缩放。

每节以编号、标题和宽幅动画开场。目录、深链接与自动吸附共用同一个对齐点，即章节分割线与导航下缘重合。手指拖动和惯性滚动由浏览器处理，页面在滚动结束后判断是否吸附，再次触屏会立即取消正在进行的定位。详细的尺寸计算与模式见[布局报告](reports/layout-system.html)。

sec2 和 sec6 将精简后的阶段名称居中放入进度条，不显示阶段编号、时间、Loop 或倍速选项，暂停图标使用 SVG 双竖线。桌面进度条高 34px，分段宽度按 65% 均分、35% 实际时长混合分配。指示线在各段内按真实时长移动；桌面可拖动定位，手机将阶段排成三列，保留 44px 点击高度、各段进度填充和点击跳转。

sec5 的四阶段进度条位于画布下方，保留阶段颜色、进度填充和点击跳转；动画使用完整画布宽度，手机阶段按钮排成两列，无需横向滑动。

正文已静态写入 `index.html`，直接在该文件中维护。首屏提供 [arXiv 论文链接](https://arxiv.org/abs/2602.11958)，GitHub 和 Hugging Face 暂以不可点击的 “Coming soon” 入口占位，待补充实际地址。作者和机构尚未添加。

实验区三张结果表的数据和指标定义保存在 `data/experiments.json`，覆盖语言建模、S-NIAH 检索和多项任务。页面通过 HTTP 读取 JSON。列名、优劣方向与换行方式由指标定义驱动；各模型规模内按列自动计算最优和次优不同数值，含并列。天蓝底色标出 RAM-Net。

## 验证

已使用本机 Chrome 对静态 HTTP 页面做动态检查：八个动画均挂载成功；sec3 的四组因子分布控件保持同一行。窄屏布局和实际 iPhone Safari/Chrome 仍需设备复核。

所有站内资源均使用相对路径，主页面没有 iframe。第 8、9 章的探针数据通过静态脚本直接提供；颜色配置与实验表格通过 HTTP 读取 JSON。

# RAM-Net 论文展示页

直接打开 `index.html` 即可预览，也可部署到静态 HTTP 服务器或子目录。全站只有 HTML、CSS、JavaScript 与本地数据文件，无构建步骤、第三方依赖或在线字体；资源路径均为相对路径。

## 文件结构

```text
index.html                      英文论文正文、章节结构、公式和动画插入位置
assets/
  site.css                      页面排版、配色、响应式布局
  site.js                       章节导航、阅读进度与动画尺寸同步
  section-scroll.js             所有章节共用的双向吸附与滚动控制
  experiments.js                读取实验 JSON、生成三张表、计算列排名与切换页签
  embed.css                     动画的统一展示样式与播放器样式
  embed.js                      独立动画页的配色、窄屏交互与帧调度
  exhibit-host.js              主页面内的 Shadow DOM 动画容器与可见性调度
  exhibit-markup.js            从八个动画 HTML 提取的静态模板
  stage-timeline.js             sec2 / sec6 共用的带阶段名称的非均匀时间轴
  favicon.svg                   本地站点图标
animations/
  attn_cmp.{html,css,js}         注意力与存储方式对比
  ramnet_arch.{html,css,js}      RAM-Net 架构及分阶段播放器
  product_softmax.{html,css,js}  四种视图、Top-K 和分布交互
  cape.{html,css,js}             CAPE 开关、分布拖动与位置响应
  gsu.{html,css,js}              质量、门控、向量的直接交互
  cal_pipeline.{html,css,js}     CUDA 执行流水线及分阶段播放器
  niah_probe.{html,js}           第 8 章探针动画
  head_probe.{html,js}           第 9 章探针动画
data/experiments.json           实验结果唯一的 JSON 数据源
data/experiments.js             本地直接打开时使用的数据快照
data/probes/
  *.json                         原始 trace 数据
  *.js                           供页面直接使用的静态数据
```

动画保留独立页面和共享的交互脚本，主页面使用 `assets/exhibit-markup.js` 中的静态 HTML 模板。修改 `animations/*.html` 的结构后，应同步更新该模板；调整样式或交互脚本无需重新生成模板。

主页面使用 Shadow DOM 将八个动画直接嵌入正文中的 div，隔离变量与样式；不使用 iframe。动画的 HTML 模板由 `animations/*.html` 提取到 `assets/exhibit-markup.js`，交互脚本仍复用对应的 `animations/*.js`。第 8、9 章的 JSON 同时保存为静态 JavaScript 数据文件，页面直接读取，无运行时数据请求。离开可视区的动画停止逐帧绘制，并尊重系统的减少动态效果设置。

动画窗口宽度不超过 760px，或不超过 1024px 且使用粗指针触控时，自动启用简化交互：停用概率、权重、门控、质量和向量的精细编辑，保留页签、Top-K、播放和阶段切换。CAPE 和 GSU 提供独立的大按钮，主要触控目标至少为 44px；宽图可原生滑动浏览。恢复桌面尺寸和鼠标输入后，精细交互自动恢复。

每节以编号、标题和宽幅动画开场，正文、表格与公式共用对齐线。所有正文 section 共用双向吸附：滚动停止后，靠近章节起点时平滑对齐分割线与顶部导航栏；继续向外滚动会短暂冷却。动画在同一页面中，滚动事件直接进入共用逻辑。

sec2 和 sec6 将精简后的阶段名称居中放入进度条，不显示阶段编号、时间、Loop 或倍速选项，暂停图标使用 SVG 双竖线。桌面进度条高 34px，分段宽度按 65% 均分、35% 实际时长混合分配。指示线在各段内按真实时长移动；桌面可拖动定位，手机将阶段排成三列，保留 44px 点击高度、各段进度填充和点击跳转。

sec5 的四阶段进度条位于画布下方，保留阶段颜色、进度填充和点击跳转；动画使用完整画布宽度，手机阶段按钮排成两列，无需横向滑动。

正文已静态写入 `index.html`，直接在该文件中维护。首屏提供 [arXiv 论文链接](https://arxiv.org/abs/2602.11958)，GitHub 和 Hugging Face 暂以不可点击的 “Coming soon” 入口占位，待补充实际地址。作者和机构尚未添加。

实验区三张结果表的数据保存在 `data/experiments.json`，覆盖语言建模、S-NIAH 检索和多项任务。HTTP 页面直接读取该 JSON；直接打开文件时使用由同一 JSON 生成的 `data/experiments.js` 快照。各模型规模内按列自动计算最优和次优不同数值，含并列；总状态与活跃状态按越小越好处理。天蓝底色标出 RAM-Net。

## 验证

已使用本机 Chrome 对静态 HTTP 与 `file://` 两种打开方式做动态检查：八个动画均挂载成功，无控制台错误；sec2、sec3、sec5、sec6 的基础控件可操作，sec9 的两个标签、Head 选择、播放控件和 Canvas 均正常显示。窄屏布局在 Chrome 的 500px 视口下检查；实际 iPhone Safari/Chrome 仍需设备复核。

所有站内资源均使用相对路径，主页面没有 iframe。第 8、9 章的探针数据通过静态脚本直接提供；实验表格在 HTTP 下读取 JSON，本地 `file://` 预览使用静态脚本副本。

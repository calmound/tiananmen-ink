# 雪中京城 · 水墨三维地图

用 Three.js 做的北京二环水墨地图。可以从城区上空飞到太和殿、天安门等地标，也可以在雪昼、晴昼和雪夜之间切换。

## 运行

需要 Node.js 20.19+（20.x）或 22.12+，以及支持 WebGPU 或 WebGL2 的浏览器。先 [下载源码 ZIP](https://github.com/calmound/tiananmen-ink/archive/refs/heads/main.zip)，解压后在项目根目录运行：

```sh
cd app
npm ci
npm run dev
```

打开终端输出的本地地址（默认 `http://127.0.0.1:5173/`）。左键拖动平移，滚轮缩放，右键旋转倾斜；点击地名或在右上角搜索，可以飞过去并查看信息卡；左下角是小地图和比例尺，右下角有漫游、存图、缩放、指北和“全景”；底部中间切换雪昼、晴昼、雪夜。浏览器需支持 WebGPU 或 WebGL2。

| 地址参数 | 功能 |
| --- | --- |
| `?debug` | 查看水墨参数、渲染通道和运行指标 |
| `?view=` / `?shot=` | 预设视角：overview（二环全景）、center、tiananmen、palace、square、taihe、jingshan、jiaolou、tiantan、gulou、shichahai、qianmen；`shot` 不显示操作提示，30 帧后 `window.__ready = true` |
| `?select=` / `?snow=0` | 打开时直接选中某个地点并显示信息卡；关闭飘雪 |
| `?mood=snow\|clear\|night` | 打开时的时令：雪昼 / 晴昼 / 雪夜 |
| `?preset=` / `?channel=` | 水墨预设（A-lines、B-tones、C-full），单独查看某个通道 |
| `?backend=webgl` | 强制使用 WebGL2，便于检查退回路径 |
| `?quality=high` | 固定原有高清分辨率（DPR 上限 2）；默认自动控制像素预算，操作时降低分辨率，停止后恢复。存图自动使用高清分辨率 |


## 验证与构建

```sh
cd app
npm run verify
npm run build
```

## 地图数据与许可

地图数据来自 [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，由 Overpass API 获取并转换为本地米制坐标。仓库中的衍生数据 [axis-layout.json](data/axis-layout.json) 和 [city.json](app/public/data/city.json) 采用 [Open Database License 1.0（ODbL）](https://opendatacommons.org/licenses/odbl/1-0/)。两份文件都已随源码提供，运行时直接读取。

`data/` 中的 Python 脚本记录了地图数据的获取与处理方法。运行项目无需重新抓取 OSM 数据。部分高度和建筑比例为估计值，远山、云海和飞鸟是为画面加入的写意效果。

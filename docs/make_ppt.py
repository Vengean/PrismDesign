#!/usr/bin/env python3
"""Generate PrismDesign 3-page presentation."""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# ── Brand colors ──
PRIMARY = RGBColor(99, 102, 241)    # Indigo #6366f1
DARK = RGBColor(30, 30, 46)
WHITE = RGBColor(255, 255, 255)
LIGHT_BG = RGBColor(245, 245, 250)
GRAY = RGBColor(107, 114, 128)
ACCENT_RED = RGBColor(239, 68, 68)
ACCENT_GREEN = RGBColor(34, 197, 94)
ACCENT_PURPLE = RGBColor(139, 92, 246)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
W = prs.slide_width
H = prs.slide_height


def add_bg(slide, color):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_text_box(slide, left, top, width, height, text, font_size=18,
                 color=DARK, bold=False, align=PP_ALIGN.LEFT, font_name="Microsoft YaHei"):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(font_size)
    p.font.color.rgb = color
    p.font.bold = bold
    p.font.name = font_name
    p.alignment = align
    return txBox


def add_bullet_list(slide, left, top, width, height, items, font_size=16,
                    color=DARK, spacing=Pt(8)):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        p.text = item
        p.font.size = Pt(font_size)
        p.font.color.rgb = color
        p.font.name = "Microsoft YaHei"
        p.space_after = spacing
    return txBox


def add_rounded_rect(slide, left, top, width, height, fill_color, text="",
                     font_size=14, font_color=WHITE, bold=False):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()
    shape.shadow.inherit = False
    if text:
        tf = shape.text_frame
        tf.word_wrap = True
        tf.paragraphs[0].alignment = PP_ALIGN.CENTER
        p = tf.paragraphs[0]
        p.text = text
        p.font.size = Pt(font_size)
        p.font.color.rgb = font_color
        p.font.bold = bold
        p.font.name = "Microsoft YaHei"
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    return shape


def add_arrow(slide, left, top, width):
    shape = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, left, top, width, Inches(0.3))
    shape.fill.solid()
    shape.fill.fore_color.rgb = GRAY
    shape.line.fill.background()
    return shape


# ============================================================
# Page 1: Problems
# ============================================================
slide1 = prs.slides.add_slide(prs.slide_layouts[6])  # blank
add_bg(slide1, DARK)

# Title
add_text_box(slide1, Inches(0.8), Inches(0.5), Inches(11), Inches(0.8),
             "01  现状与痛点", 36, WHITE, bold=True)
add_text_box(slide1, Inches(0.8), Inches(1.2), Inches(11), Inches(0.5),
             "AI 时代，研发流程的效率瓶颈不在编码，而在协作", 18, GRAY)

# ── Left block: Traditional flow ──
add_rounded_rect(slide1, Inches(0.8), Inches(2.2), Inches(5.6), Inches(0.5),
                 ACCENT_RED, "传统研发流程", 14, WHITE, bold=True)

flow_items = ["需求文档", "设计稿", "前端编码", "视觉走查", "修改返工"]
x_start = Inches(0.8)
for i, item in enumerate(flow_items):
    add_rounded_rect(slide1, x_start + Inches(i * 1.15), Inches(3.0),
                     Inches(0.95), Inches(0.45), RGBColor(55, 55, 75),
                     item, 11, WHITE)
    if i < len(flow_items) - 1:
        add_text_box(slide1, x_start + Inches(i * 1.15 + 0.95), Inches(3.05),
                     Inches(0.2), Inches(0.35), "→", 14, GRAY)

pain_items_left = [
    "串行等待：每个环节必须等上一个完成",
    "产出物断裂：文档 / 设计稿 / 代码各自独立",
    "视觉还原难：反复走查，逐一核对间距颜色",
    "沟通成本高：多轮会议确认细节",
]
add_bullet_list(slide1, Inches(0.8), Inches(3.7), Inches(5.6), Inches(2.5),
                [f"  {item}" for item in pain_items_left], 13, RGBColor(200, 200, 210))

# ── Right block: AI silo ──
add_rounded_rect(slide1, Inches(7.0), Inches(2.2), Inches(5.6), Inches(0.5),
                 ACCENT_PURPLE, "各角色独立使用 AI（行业现状）", 14, WHITE, bold=True)

ai_items = ["产品 AI 生成原型", "设计 AI 出设计稿", "开发 AI 写代码"]
for i, item in enumerate(ai_items):
    add_rounded_rect(slide1, Inches(7.0) + Inches(i * 1.95), Inches(3.0),
                     Inches(1.75), Inches(0.45), RGBColor(55, 55, 75),
                     item, 11, WHITE)
    if i < len(ai_items) - 1:
        add_text_box(slide1, Inches(7.0) + Inches(i * 1.95 + 1.75), Inches(3.05),
                     Inches(0.2), Inches(0.35), "→", 14, GRAY)

pain_items_right = [
    "同一页面被 AI 生成三遍，每次从零开始",
    "无法继承项目组件库、设计规范、技术栈",
    "AI 生成的代码不符合项目规范",
    "交接返工成本并未减少",
]
add_bullet_list(slide1, Inches(7.0), Inches(3.7), Inches(5.6), Inches(2.5),
                [f"  {item}" for item in pain_items_right], 13, RGBColor(200, 200, 210))

# Bottom highlight
add_rounded_rect(slide1, Inches(2.5), Inches(6.3), Inches(8.3), Inches(0.7),
                 RGBColor(45, 45, 65),
                 "核心矛盾：需求 → 设计 → 代码，每次转化都是信息损耗",
                 16, RGBColor(255, 200, 100), bold=True)

# ============================================================
# Page 2: Solution
# ============================================================
slide2 = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(slide2, WHITE)

add_text_box(slide2, Inches(0.8), Inches(0.5), Inches(11), Inches(0.8),
             "02  PrismDesign 怎么做", 36, DARK, bold=True)
add_text_box(slide2, Inches(0.8), Inches(1.15), Inches(11), Inches(0.5),
             "Chrome 插件 + AI Agent  |  所有角色基于同一份项目源码协作，最终产物就是可上线的代码", 17, GRAY)

# ── Top: the single-context concept ──
# Left: traditional 3 artifacts
trad_x = Inches(0.8)
trad_y = Inches(2.0)
add_text_box(slide2, trad_x, trad_y, Inches(5.5), Inches(0.4),
             "传统：三份独立产物，逐级转化", 14, GRAY, bold=True)

artifacts = [("需求文档", ACCENT_RED), ("设计稿", ACCENT_PURPLE), ("项目代码", RGBColor(59, 130, 246))]
for i, (name, color) in enumerate(artifacts):
    ax = trad_x + Inches(i * 1.85)
    add_rounded_rect(slide2, ax, trad_y + Inches(0.45), Inches(1.55), Inches(0.42),
                     color, name, 12, WHITE, bold=True)
    if i < 2:
        add_text_box(slide2, ax + Inches(1.55), trad_y + Inches(0.47),
                     Inches(0.3), Inches(0.35), "→", 16, GRAY)

# Right: PrismDesign single artifact
pd_x = Inches(7.2)
add_text_box(slide2, pd_x, trad_y, Inches(5.5), Inches(0.4),
             "PrismDesign：唯一产出物", 14, DARK, bold=True)
add_rounded_rect(slide2, pd_x, trad_y + Inches(0.45), Inches(4.8), Inches(0.42),
                 PRIMARY, "项目源代码 = 需求 + 设计 + 实现    →    直接可上线",
                 13, WHITE, bold=True)

# ── Middle: collaboration flow with shared context ──
flow_y = Inches(3.2)
add_rounded_rect(slide2, Inches(3.5), flow_y, Inches(6.3), Inches(0.48),
                 DARK, "协作流程：所有操作都发生在同一个项目上下文中", 15, WHITE, bold=True)

# Three phase columns
phases = [
    {
        "phase": "阶段一 · Demo 搭建",
        "role": "产品经理",
        "color": RGBColor(59, 130, 246),
        "items": [
            "在浏览器中对话描述页面需求",
            "Agent 基于项目组件库生成代码",
            "HMR 热更新实时预览，继续迭代",
            "填充 Mock 数据，产出可交付 Demo",
        ]
    },
    {
        "phase": "阶段二 · 设计审查",
        "role": "设计师",
        "color": ACCENT_PURPLE,
        "items": [
            "在产品搭建的同一页面上操作",
            "可视化调整颜色、字号、间距等",
            "对元素添加评论标注修改意图",
            "一键同步 → Agent 直接改源代码",
        ]
    },
    {
        "phase": "阶段三 · 开发完善",
        "role": "前端开发",
        "color": ACCENT_GREEN,
        "items": [
            "Review Agent 生成的 Git diff",
            "代码已符合项目规范，无需重写",
            "补充业务逻辑、接口对接",
            "联调上线 —— 产物即生产代码",
        ]
    },
]

col_width = Inches(3.6)
col_gap = Inches(0.35)
col_start = Inches(0.8)

for i, phase in enumerate(phases):
    x = col_start + (col_width + col_gap) * i
    py = flow_y + Inches(0.7)

    # Phase + role header
    add_rounded_rect(slide2, x, py, col_width, Inches(0.42),
                     phase["color"], f'{phase["phase"]}  ({phase["role"]})',
                     12, WHITE, bold=True)

    # Steps
    for j, item in enumerate(phase["items"]):
        sy = py + Inches(0.6) + Inches(j * 0.55)
        add_rounded_rect(slide2, x + Inches(0.1), sy + Inches(0.03),
                         Inches(0.28), Inches(0.28), phase["color"],
                         str(j + 1), 10, WHITE, bold=True)
        add_text_box(slide2, x + Inches(0.48), sy, col_width - Inches(0.6), Inches(0.45),
                     item, 12, DARK)

    # Arrow between phases
    if i < 2:
        arrow_x = x + col_width + Inches(0.05)
        add_text_box(slide2, arrow_x, py + Inches(1.0), Inches(0.25), Inches(0.4),
                     "→", 20, PRIMARY, bold=True)

# ── Bottom: key message ──
add_rounded_rect(slide2, Inches(1.5), Inches(6.6), Inches(10.3), Inches(0.6),
                 RGBColor(240, 238, 255),
                 "从 Demo 到上线，始终是同一份代码在演进 —— 没有交接，没有转化，没有信息损耗",
                 15, PRIMARY, bold=True)

# ============================================================
# Page 3: Advantages vs Claude Code
# ============================================================
slide3 = prs.slides.add_slide(prs.slide_layouts[6])
add_bg(slide3, DARK)

add_text_box(slide3, Inches(0.8), Inches(0.5), Inches(11), Inches(0.8),
             "03  对比 Claude Code 等工具的优势", 36, WHITE, bold=True)
add_text_box(slide3, Inches(0.8), Inches(1.2), Inches(11), Inches(0.5),
             "不只是代码生成工具，而是面向业务团队的可视化协作平台", 18, GRAY)

# Comparison table
headers = ["维度", "Claude Code / Cursor 等", "PrismDesign"]
header_widths = [Inches(2.2), Inches(4.5), Inches(4.8)]
header_x = Inches(0.8)
table_y = Inches(2.1)
row_h = Inches(0.6)

# Header row
cx = header_x
for i, (h, w) in enumerate(zip(headers, header_widths)):
    color = PRIMARY if i == 2 else RGBColor(55, 55, 75)
    add_rounded_rect(slide3, cx, table_y, w - Inches(0.05), row_h,
                     color, h, 14, WHITE, bold=True)
    cx += w

rows = [
    ["使用门槛",
     "需要 IDE 环境，面向开发者",
     "Chrome 浏览器即可，产品 / 设计可直接使用"],
    ["交互方式",
     "纯文本对话 + 终端命令",
     "可视化选中 + 属性编辑 + 自然语言，三者结合"],
    ["元素定位",
     '用自然语言描述"那个蓝色按钮"，模型猜测',
     "点击即定位：自动采集组件名、源码路径、行号"],
    ["项目感知",
     "读取当前文件上下文",
     "启动时扫描全项目：框架 / 组件库 / 设计规范"],
    ["协作模式",
     "单人使用，开发者专属",
     "产品搭 Demo → 设计调视觉 → 开发补逻辑"],
    ["修改反馈",
     "修改代码后需手动刷新预览",
     "HMR 热更新，修改实时生效"],
    ["版本管理",
     "依赖用户自行管理 Git",
     "所有修改直接体现在 Git diff，天然可追溯"],
]

for ri, row in enumerate(rows):
    ry = table_y + row_h * (ri + 1) + Inches(0.05) * (ri + 1)
    cx = header_x
    bg = RGBColor(40, 40, 58) if ri % 2 == 0 else RGBColor(48, 48, 68)
    for ci, (cell, w) in enumerate(zip(row, header_widths)):
        fc = RGBColor(200, 200, 210) if ci < 2 else RGBColor(180, 230, 180)
        add_rounded_rect(slide3, cx, ry, w - Inches(0.05), row_h,
                         bg, cell, 12, fc, bold=(ci == 0))
        cx += w

# Bottom tagline
add_rounded_rect(slide3, Inches(2.5), Inches(6.5), Inches(8.3), Inches(0.6),
                 PRIMARY,
                 "PrismDesign = 可视化编辑能力 + 项目级 AI Agent + 多角色协作流程",
                 16, WHITE, bold=True)

# ── Save ──
out = "/Users/vengeanliu/Documents/ai-workspace/PrismDesign/docs/PrismDesign-介绍.pptx"
prs.save(out)
print(f"Saved: {out}")

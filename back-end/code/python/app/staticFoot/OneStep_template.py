import json
import os
import datetime
import math
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import ttfonts
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.utils import ImageReader
from PIL import Image

# ========== 配置 ==========
# 字体路径 (请确保此路径在你的机器上存在，否则会回退)
YAHEI_TTC_PATH = r"C:\Windows\Fonts\msyh.ttc"
YAHEI_BOLD_TTC_PATH = r"C:\Windows\Fonts\msyhbd.ttc" # 增加粗体路径
FONT_NAME = "MSYH"
FONT_NAME_BOLD = "MSYH_BD" # 为粗体取一个专属别名
FOOTER_HEIGHT_MM=12
# 注册常规体
if os.path.exists(YAHEI_TTC_PATH):
    pdfmetrics.registerFont(ttfonts.TTFont(FONT_NAME, YAHEI_TTC_PATH))
else:
    FONT_NAME = "Helvetica"

# 注册粗体
if os.path.exists(YAHEI_BOLD_TTC_PATH):
    try:
        pdfmetrics.registerFont(ttfonts.TTFont(FONT_NAME_BOLD, YAHEI_BOLD_TTC_PATH))
    except Exception as e:
        #print("粗体注册失败:", e)
        FONT_NAME_BOLD = FONT_NAME # 注册失败则用常规体代替
else:
    #print("未找到粗体文件，将使用常规体代替")
    FONT_NAME_BOLD = FONT_NAME




#设置路径
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
ICON_DIR = os.path.join(SCRIPT_DIR, "icon")
# ========== 辅助函数 ==========

def safe_format(value, fmt="{:.2f}"):
    """安全格式化，处理 None"""
    if value is None:
        return "-"
    try:
        return fmt.format(float(value))
    except:
        return str(value)


def draw_slash_header(c, x, y, width, height, stripe_w=6, angle_deg=45, color_hex="#f2f2f2"):
    """绘制斜纹页眉背景"""
    c.saveState()
    c.setFillColor(HexColor(color_hex))
    c.rect(x, y, width, height, stroke=0, fill=1)
    c.setFillColor(HexColor("#e6e6e6"))
    stripe_spacing = stripe_w * 2
    diagonal_length = math.sqrt(width ** 2 + height ** 2)
    slash_range = int(width / stripe_spacing) + 2
    for i in range(-slash_range, slash_range + 1):
        start_x = x + i * stripe_spacing
        c.saveState()
        c.translate(start_x, y)
        c.rotate(45)
        c.rect(0, -1, diagonal_length, 1, stroke=0, fill=1)
        c.restoreState()
    c.restoreState()


def draw_footer_bar(c, W, footer_h):
    c.saveState()
    c.setFillColor(HexColor("#000000"))
    c.rect(0, 0, W, footer_h, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(FONT_NAME, 9)
    c.drawCentredString(W / 2, footer_h / 2 - 4, "OneStep FootLab")
    c.restoreState()


def draw_header_text(c, margin, W, H, title):
    c.setFillColor(black)
    c.setFont(FONT_NAME_BOLD, 22)
    c.drawString(margin, H - margin - 3 * mm, title)
    c.setFont(FONT_NAME_BOLD, 12)
    gen_date = datetime.datetime.now().strftime("%Y/%m/%d")
    c.drawString(margin, H - margin - 9 * mm, f"生成日期: {gen_date}")
    return H - margin - 10 * mm


def draw_header_divider(c, margin, W, date_y):
    c.saveState()
    divider_y = date_y - 1 * mm
    divider_length = W - 1.8 * margin
    c.setStrokeColor(HexColor("#cccccc"))
    c.setLineWidth(1.0)
    c.line(margin, divider_y, margin + divider_length, divider_y)
    c.restoreState()


def draw_image_in_rect(c, image_path, x, y, w, h, scale=1.0, rotate_mirror=False):
    """
    在指定矩形区域内绘制图片，保持比例居中
    scale: 缩放系数，1.0 表示填满区域，0.8 表示缩小到80%
    rotate_mirror: 仅对热力图生效——先逆时针90°再水平镜像
    """
    if not image_path or not os.path.exists(image_path):
        # 绘制缺失占位
        c.saveState()
        c.setStrokeColor(HexColor("#cccccc"))
        c.setLineWidth(1)
        c.setDash([2, 2], 0)
        c.rect(x, y, w, h)
        c.setFont(FONT_NAME, 9)
        c.setFillColor(HexColor("#999999"))
        c.drawCentredString(x + w / 2, y + h / 2, "Image Not Found")
        c.restoreState()
        return

    try:
        img = Image.open(image_path)          # 改用 PIL 先加载
        if rotate_mirror:                     # ── 只针对热力图 ──
            img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)  # 水平镜像
            img = img.rotate(90, expand=True)                   # 逆时针90°
        img_reader = ImageReader(img)         # 再包回 ImageReader

        iw, ih = img_reader.getSize()
        aspect = ih / float(iw)

        # 以下与原逻辑完全一致
        if aspect > h / w:
            draw_h = h
            draw_w = h / aspect
        else:
            draw_w = w
            draw_h = w * aspect

        draw_w *= scale
        draw_h *= scale
        draw_x = x + (w - draw_w) / 2
        draw_y = y + (h - draw_h) / 2

        c.drawImage(img_reader, draw_x, draw_y, width=draw_w, height=draw_h, mask='auto')
    except Exception as e:
        print(f"Error drawing image {image_path}: {e}")


# ========== 页面绘制逻辑 ==========

def page1(c, W, H, margin, data_json):
    """第一页：基本信息、热力图、指标胶囊（仅新增图标嵌入功能，其余逻辑不变）"""
    # 解构数据
    arch = data_json.get("arch_features", {})
    add = data_json.get("additional_data", {})
    imgs = data_json.get("image_paths", {})

    # ========== 新增：足弓类型判断函数 ==========
    def get_arch_type(area_AI_str):
        """根据足弓指数返回足弓类型"""
        if area_AI_str == "-" or area_AI_str is None:
            return "-"
        try:
            area_AI = float(area_AI_str)
            if area_AI < 0.20:
                return "高足弓"
            elif area_AI < 0.21:
                return "正常偏高"
            elif area_AI <= 0.26:
                return "正常足弓"
            elif area_AI <= 0.27:
                return "正常偏扁"
            else:
                return "扁平足"
        except:
            return "-"

    # 头部
    header_band_h = 8 * mm
    draw_slash_header(c, 0, H - header_band_h, W, header_band_h)
    date_y = draw_header_text(c, margin, W, H, "OneStep Report")

    logo_path = os.path.join(ICON_DIR, "logo.png")
    if os.path.exists(logo_path):
        logo_h = 14 * mm
        logo_w = 14 * mm
        logo_x = W - margin - 90
        logo_y = H - margin - logo_h + 15
        draw_image_in_rect(c, logo_path, logo_x, logo_y, logo_w, logo_h, scale=2.8)

    draw_header_divider(c, margin, W, date_y)

    top_y = date_y - 6 * mm
    page_bottom = margin + FOOTER_HEIGHT_MM * mm

    # --- 左侧区域 ---
    left_x = margin
    left_w = W * 0.65 - margin
    left_top = top_y
    left_bottom = page_bottom + 205 * mm
    left_h = left_top - left_bottom

    c.setFillColor(HexColor("#f4f4f4"))
    c.roundRect(left_x, left_bottom, left_w, left_h, 6, stroke=0, fill=1)

    # 基本信息
    user_info = data_json.get("user_info", {})
    user_name = user_info.get("name") if user_info.get("name") else "Guest"
    user_gender = user_info.get("gender") if user_info.get("gender") else "-"
    user_age = user_info.get("age") if user_info.get("age") is not None else "-"
    user_id = user_info.get("id") if user_info.get("id") else "-"

    c.setFillColor(black)
    c.setFont(FONT_NAME, 10)
    info_x = left_x + 6 * mm
    info_y = left_top - 10 * mm

    # 格式化显示
    label_name = f"姓名: {user_name}"
    label_gender = f"性别: {user_gender}"
    label_age = f"年龄: {user_age}"
    label_id = f"编号: {user_id}"

    c.drawString(info_x, info_y, label_name)
    c.drawString(info_x + 60 * mm, info_y, label_gender)
    info_y -= 8 * mm
    c.drawString(info_x, info_y, label_age)
    c.drawString(info_x + 60 * mm, info_y, label_id)

    # 热力图区域
    heatmap_y = info_y - 15 * mm
    heatmap_height = left_bottom - 10 * mm + heatmap_y
    heatmap_x = left_x + 2 * mm
    heatmap_width = left_w - 4 * mm
    heatmap_rect_h = 160 * mm

    heatmap_box_y = info_y - 10 * mm - heatmap_rect_h

    # 绘制热力图
    hm_path = imgs.get("heatmap_external") or imgs.get("heatmap_internal")
    draw_image_in_rect(c, hm_path, heatmap_x + 6 * mm, heatmap_box_y + 2 * mm, heatmap_width - 4 * mm,
                       heatmap_rect_h - 4 * mm, rotate_mirror=True, scale=1.275)#1.5
    partition_path = imgs.get("arch_regions")
    partition_height = 50 * mm
    partition_y = heatmap_box_y - partition_height - 4 * mm

    c.setFont(FONT_NAME_BOLD, 8)

    draw_image_in_rect(c, partition_path,
                       heatmap_x, partition_y + 20 * mm,
                       heatmap_width - 4 * mm, partition_height - 6 * mm, scale=1.19)#1.4

    # --- 右侧 12 单元指标 ---
    right_x = left_x + left_w + 3 * mm
    right_w = W - margin - right_x
    square_size = 12 * mm
    big_capsule_h = 0.42 * square_size
    pad = 2 * mm
    big_capsule_len = right_w - 1 * pad + 3 * mm
    small_capsule_len = big_capsule_len / 4.5
    small_capsule_h = big_capsule_h * 0.65

    right_top = top_y - 6 * mm
    right_bottom = page_bottom - 72 * mm
    total_h = right_top - right_bottom
    spacing = 1 * mm
    unit_h = (total_h - spacing * 72) / 12

    icons_list = [
        "ai.png", "len.png", "wid.png", "total_area.png",
        "f_area.png", "m_area.png", "b_area.png", "f_press.png",
        "m_press.png", "b_press.png", "cop_dist.png", "diff.png"
    ]

    # 指标数据映射
    metrics_map = [
        ("足弓指数(AI)", safe_format(arch.get("left_foot", {}).get("area_index"), "{:.3f}"),
         safe_format(arch.get("right_foot", {}).get("area_index"), "{:.3f}")),
        ("足长(cm)", safe_format(add.get("left_length")), safe_format(add.get("right_length"))),
        ("足宽(cm)", safe_format(add.get("left_width")), safe_format(add.get("right_width"))),
        ("全足面积(cm²)", safe_format(add.get("left_area", {}).get("total_area_cm2")),
         safe_format(add.get("right_area", {}).get("total_area_cm2"))),
        ("前足面积(cm²)", safe_format(add.get("left_area", {}).get("area_cm2", [0, 0, 0])[0]),
         safe_format(add.get("right_area", {}).get("area_cm2", [0, 0, 0])[0])),
        ("中足面积(cm²)", safe_format(add.get("left_area", {}).get("area_cm2", [0, 0, 0])[1]),
         safe_format(add.get("right_area", {}).get("area_cm2", [0, 0, 0])[1])),
        ("后足面积(cm²)", safe_format(add.get("left_area", {}).get("area_cm2", [0, 0, 0])[2]),
         safe_format(add.get("right_area", {}).get("area_cm2", [0, 0, 0])[2])),
        ("前足压力(%)", safe_format(add.get("left_pressure", {}).get("前足", 0) * 100, "{:.1f}"),
         safe_format(add.get("right_pressure", {}).get("前足", 0) * 100, "{:.1f}")),
        ("中足压力(%)", safe_format(add.get("left_pressure", {}).get("中足", 0) * 100, "{:.1f}"),
         safe_format(add.get("right_pressure", {}).get("中足", 0) * 100, "{:.1f}")),
        ("后足压力(%)", safe_format(add.get("left_pressure", {}).get("后足", 0) * 100, "{:.1f}"),
         safe_format(add.get("right_pressure", {}).get("后足", 0) * 100, "{:.1f}")),
        ("COP距左右脚中心(cm)",
         safe_format(add.get("cop_results", {}).get("dist_left_to_both")),
         safe_format(add.get("cop_results", {}).get("dist_right_to_both"))),
        ("左右脚前后差(cm)",
         safe_format(add.get("cop_results", {}).get("left_forward")),
         "-")
    ]

    for i in range(12):
        label, val_l, val_r = metrics_map[i]
        unit_top = right_top - i * (unit_h + spacing)

        # 大胶囊
        cap_x = right_x + pad
        cap_y = unit_top - big_capsule_h + 5 * mm
        c.setStrokeColor(HexColor("#000000"))
        c.roundRect(cap_x, cap_y, big_capsule_len, big_capsule_h, big_capsule_h / 2, stroke=1, fill=0)

        # 文字居中
        c.setFillColor(black)
        c.setFont(FONT_NAME, 9)
        text_y = cap_y + big_capsule_h / 2 - 3
        c.drawCentredString(cap_x + big_capsule_len / 2, text_y, label)

        # 左侧正方形
        sq_bottom = unit_top - unit_h + 6 * mm
        sq_y = sq_bottom
        c.roundRect(cap_x + 7, sq_y, square_size, square_size, 2, stroke=1, fill=0)

        # 嵌入图标
        icon_path = os.path.join(ICON_DIR, icons_list[i])
        draw_image_in_rect(
            c,
            icon_path,
            cap_x + 7 + 1.5 * mm,
            sq_y + 1 * mm,
            square_size - 3 * mm,
            square_size - 3 * mm,
            scale=1.5
        )

        # 右侧小胶囊区域
        small_total_w = small_capsule_len * 2 + 11 * mm
        small_x = cap_x + big_capsule_len - small_total_w
        small_y = sq_y + square_size - small_capsule_h

        # L 小胶囊
        c.roundRect(small_x, small_y, small_capsule_len, small_capsule_h, small_capsule_h / 2, stroke=1, fill=0)
        # R 小胶囊
        c.roundRect(small_x + small_capsule_len + 6 * mm, small_y, small_capsule_len, small_capsule_h,
                    small_capsule_h / 2, stroke=1, fill=0)

        # 胶囊内显示 L / R 标签
        c.setFont(FONT_NAME, 7)
        font_size = 7
        text_offset = font_size * 0.35

        c.drawCentredString(small_x + small_capsule_len / 2, small_y + small_capsule_h / 2 - text_offset, "L")
        c.drawCentredString(small_x + small_capsule_len + 6 * mm + small_capsule_len / 2,
                            small_y + small_capsule_h / 2 - text_offset, "R")

        # ========== 修改部分：数值显示 + 足弓类型判断 ==========
        value_y = small_y - 4.5 * mm
        value_font_size = 9
        c.setFont("Helvetica-Bold", value_font_size)

        # 显示数值
        c.drawCentredString(small_x + small_capsule_len / 2, value_y, str(val_l))
        c.drawCentredString(small_x + small_capsule_len + 6 * mm + small_capsule_len / 2, value_y, str(val_r))

        # ========== 如果是第一项（足弓指数），则增加足弓类型显示 ==========
        if i == 0:  # 第一项是足弓指数
            type_y = value_y - 4 * mm  # 在数值下方
            c.setFont(FONT_NAME_BOLD, 8)  # 使用较小字体
            #c.setFillColor(HexColor("#666666"))  # 灰色文字

            # 获取足弓类型
            arch_type_l = get_arch_type(val_l)
            arch_type_r = get_arch_type(val_r)

            # 绘制左脚足弓类型
            c.drawCentredString(small_x + small_capsule_len / 2, type_y, arch_type_l)
            # 绘制右脚足弓类型
            c.drawCentredString(small_x + small_capsule_len + 6 * mm + small_capsule_len / 2, type_y, arch_type_r)

            c.setFillColor(black)  # 恢复黑色

        # 竖线
        sep_x = small_x + small_capsule_len + 3 * mm
        sep_y0 = sq_y + 1 * mm
        sep_y1 = small_y + small_capsule_h - 5 * mm
        c.line(sep_x, sep_y0, sep_x, sep_y1)

    draw_footer_bar(c, W, FOOTER_HEIGHT_MM * mm)


def page2(c, W, H, margin, data_json):
    """第二页：图表 (COP轨迹, 椭圆, 速度)"""
    imgs = data_json.get("image_paths", {})

    header_band_h = 8 * mm
    draw_slash_header(c, 0, H - header_band_h, W, header_band_h)
    date_y = draw_header_text(c, margin, W, H, "OneStep Report - 图表")
    draw_header_divider(c, margin, W, date_y)

    box_w = W - 2 * margin
    box_gap = 6 * mm
    box_h = (H - 2 * margin - header_band_h - 2 * box_gap - FOOTER_HEIGHT_MM * mm) / 3.0
    top_y = H - margin - header_band_h - 6 * mm

    # 更新后的配置
    charts_config = [
        ("压力中心轨迹", "COP trajectory", "cop_trajectory"),
        ("压力中心分布面积", "COP confidence ellipse", "confidence_ellipse"),
        ("压力中心变化速率", "COP velocity time series", "velocity_series")
    ]

    for i, (title_cn, title_en, img_key) in enumerate(charts_config):
        y = top_y - i * (box_h + box_gap)
        rect_y = y - box_h

        # 1. 绘制外框
        c.setStrokeColor(HexColor("#000000"))
        c.roundRect(margin, rect_y, box_w, box_h, 6, stroke=1, fill=0)

        # 2. 绘制左侧中文标题 (使用你注册的粗体)
        c.setFillColor(black)
        c.setFont(FONT_NAME_BOLD, 12) # 建议标题稍小一点点，更精致
        c.drawString(margin + 6 * mm, rect_y + box_h - 8 * mm, title_cn)

        # 3. 绘制右侧英文标题 (右对齐)
        c.setFont("Helvetica-Bold", 12) # 英文通常比中文显得大，所以字号小一点
        # drawRightString 可以在指定的坐标点向左延伸显示文字
        c.drawRightString(margin + box_w - 6 * mm, rect_y + box_h - 8 * mm, title_en)

        # 4. 绘制图片 (调整了 y 坐标偏移，确保图片在框内居中)
        img_path = imgs.get(img_key)
        # 注意：这里将 h 限制设为 box_h - 12*mm，留出顶部的标题高度，避免重叠
        draw_image_in_rect(
            c, img_path,
            margin + 2 * mm,
            rect_y + 1 * mm,
            box_w - 4 * mm,
            box_h - 12 * mm,
            scale=1.02 # 略微放大，利用空间
        )

    draw_footer_bar(c, W, FOOTER_HEIGHT_MM * mm)

def page3(c, W, H, margin, data_json):
    """第三页：参数表格"""
    cop_data = data_json.get("cop_time_series", {})

    header_band_h = 8 * mm
    draw_slash_header(c, 0, H - header_band_h, W, header_band_h)
    date_y = draw_header_text(c, margin, W, H, "OneStep Report - 参数")
    draw_header_divider(c, margin, W, date_y)

    left = margin
    table_w = W - 2 * margin
    title_h = 8 * mm

    # 表头
    c.setFillColor(HexColor("#222222"))
    c.roundRect(left, H - margin - 16 * mm - title_h, table_w, title_h, 6, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont(FONT_NAME, 12)
    col_gap = 2 * mm
    col1_w = (table_w - col_gap) * 0.5
    col2_w = (table_w - col_gap) * 0.5
    c.drawCentredString(left + col1_w / 2, H - margin - 16 * mm - title_h / 2 - 4, "参数")
    c.drawCentredString(left + col1_w + col_gap + col2_w / 2, H - margin - 16 * mm - title_h / 2 - 4, "数值（单位）")

    # 参数映射: (显示名称, JSON Key, 单位)
    params_mapping = [
        ("压力中心轨迹长度", "path_length", " mm"),
        ("压力中心活动总面积", "contact_area", " mm²"),
        ("压力中心摆动稳定系数", "ls_ratio", ""),
        ("压力中心摆动均匀系数", "eccentricity", ""),
        ("压力中心左右摆动幅度系数", "delta_y", " "),
        ("压力中心前后摆动幅度系数", "delta_x", " "),
        ("压力中心最大摆幅", "major_axis", " mm"),
        ("压力中心稳定摆幅", "minor_axis", " mm"),
        ("压力中心最大离心", "max_displacement", " mm"),
        ("压力中心最小离心", "min_displacement", " mm"),
        ("压力中心偏移平均速度", "avg_velocity", " mm/s"),
        ("压力中心摆动强度", "rms_displacement", " mm"),
        ("压力中心左右方向标准差", "std_y", " mm"),
        ("压力中心前后方向标准差", "std_x", " mm")
    ]

    row_h = 8 * mm
    x_left = left
    y = H - margin - 16 * mm - title_h - 6 * mm
    c.setFont(FONT_NAME, 11)
    c.setFillColor(black)
    c.setStrokeColor(HexColor("#cccccc"))

    for p_name, p_key, p_unit in params_mapping:
        val = cop_data.get(p_key)
        val_str = safe_format(val) + p_unit if val is not None else "-"

        # Param Name
        c.roundRect(x_left, y - row_h, col1_w, row_h, 3, stroke=1, fill=0)
        c.drawCentredString(x_left + col1_w / 2, y - row_h / 2 - 2, p_name)

        # Value
        c.roundRect(x_left + col1_w + col_gap, y - row_h, col2_w, row_h, 3, stroke=1, fill=0)
        c.drawCentredString(x_left + col1_w + col_gap + col2_w / 2, y - row_h / 2 - 2, val_str)

        y -= row_h + 5 * mm
        if y - row_h < margin + FOOTER_HEIGHT_MM * mm + 6 * mm:
            break

    draw_footer_bar(c, W, FOOTER_HEIGHT_MM * mm)


def page4(c, W, H, margin):
    """第四页：静态注释页 (保持原逻辑不变)"""
    header_band_h = 8 * mm
    draw_slash_header(c, 0, H - header_band_h, W, header_band_h)
    date_y = draw_header_text(c, margin, W, H, "OneStep Report - 参数说明")
    draw_header_divider(c, margin, W, date_y)

    title_y = date_y - 16 * mm
    c.setFont(FONT_NAME, 36)
    c.setFillColor(black)
    c.drawString(margin, title_y, "注释")
    c.setFont(FONT_NAME, 12)
    c.drawString(margin, title_y - 6 * mm, "Annotation")

    content_top = title_y - 15 * mm
    content_bottom = margin + FOOTER_HEIGHT_MM * mm + 10 * mm

    # (此处省略了长文本 parameter_explanations 列表的定义，直接复用原逻辑)
    # 为节省空间，我直接复制你提供的 smart_wrap_text 和循环逻辑，确保完整性

    parameter_explanations = [
        {"name": "【足弓指数(AI)】",
         "desc": "足弓指数(AI)是通过计算中足面积与前足、中足、后足总面积的比例来评估的。比例值越大，说明中足的接触面积越大，足弓越低。",
         "normal": "正常值: 0.21~0.26，如果超过0.26则可能提示存在高平足问题。"},
        {"name": "【足长】",
         "desc": "脚踩在地上时，从脚趾头最前端到脚跟最后端的直线距离。有助于看清双脚是否对称，确定足长，便于选择大小合适的鞋子。",
         "normal": ""},
        {"name": "【足宽】", "desc": "足印最宽处的横向距离，通常指脚掌最宽处到脚跟最宽处的直线距离。", "normal": ""},
        {"name": "【总面积】",
         "desc": "脚掌和地面完全接触的面积。如果左右脚的接触面积差别超过15%，提示双脚受力不均，需留意是否有走路姿势问题或脚部异常。",
         "normal": ""},
        {"name": "【前/中/后足面积】",
         "desc": "脚掌不同部分（前脚掌、足弓中间、后脚跟）和地面接触的面积大小。前足面积大说明前脚掌（脚趾到脚掌前半部分）贴地多，可能是走路时前脚掌用劲大，如踮脚、跑步蹬地发力。中足面积大说明足弓中间部分（脚心）贴地多，提示足弓比较低，如扁平足。后足面积大说明后脚跟（脚后跟）贴地多。",
         "normal": ""},
        {"name": "【前/中/后足压力】",
         "desc": "脚掌不同部位（前脚掌、足弓、后脚跟）承受的体重比例。前足压力是指脚趾到脚掌前半部分承受的体重比例，正常占40%~50%。中足压力是指足弓中间部分承受的体重比例，正常只有5%~10%。如果太高，可能提示足弓较低或扁平足。后足压力是指脚后跟承受的体重比例，正常占40%~50%。",
         "normal": ""},
        {"name": "【COP距整体中心】",
         "desc": "单脚踩地时，脚底压力中心到双脚总压力中心的距离。距离越小说明脚越靠近身体重心，承重越均匀；距离越大说明脚偏了，可能走路姿势不太稳。",
         "normal": ""},
        {"name": "【左右脚前后差】", "desc": "左脚COP相对右脚的前后位置差。如果数值是正的，说明左脚的压力中心比右脚更靠前，也就是左脚往前探了。如果数值是负的，说明右脚的压力中心比左脚更靠前，也就是右脚往前探了。该数据有助于检验站姿是否歪。",
         "normal": "正值：左脚靠前；负值：右脚靠前；绝对值>2cm提示站姿不对称。"},
        {"name": "【压力中心轨迹长度】",
         "desc": "压力中心点移动的总路径长度。数值越大说明身体摆动越频繁，平衡控制越差。正常站立时，30秒内轨迹长度应小于1000毫米（mm）。如果超过1000mm，可能提示平衡能力较弱。轨迹长度越短，平衡越好；越长，平衡越差。",
         "normal": ""},
        {"name": "【压力中心活动总面积】",
         "desc": "压力中心点活动范围的面积。数值越大说明摆动幅度越大，姿势稳定性越差。老年人通常比年轻人大 20~30%。",
         "normal": ""},
        {"name": "【压力中心摆动幅度系数】", "desc": "压力中心点椭圆的长轴与短轴之比。比值越大说明摆动方向性越明显。",
         "normal": ""},
        {"name": "【压力中心摆动均匀系数】",
         "desc": "椭圆偏离圆形的程度(0~1)。越接近1说明摆动越呈线性。越接近0说明各方向摆动均匀。", "normal": ""},
        {"name": "【压力中心左右摆动幅度系数】", "desc": "左右方向最大摆动幅度。数值越大说明左右稳定性越差。",
         "normal": ""},
        {"name": "【压力中心前后摆动幅度系数】", "desc": "前后方向最大摆动幅度。数值越大说明前后稳定性越差。",
         "normal": ""},
        {"name": "【压力中心最大摆幅】", "desc": "COP椭圆的最大直径。代表主要摆动方向的幅度。配合长/短轴比判断摆动模式。如果长轴太长，说明站立方向重心不稳；配合长 / 短轴比看，能判断前后晃还是左右晃更明显。", "normal": ""},
        {"name": "【压力中心稳定摆幅】",
         "desc": "COP椭圆的最小直径。代表次要摆动方向的幅度。数值越小说明该方向控制越好。短轴数值越小，说明这个方向控制得越好，如果短轴太长，可能说明左右容易歪。",
         "normal": ""},
        {"name": "【压力中心最大离心】", "desc": "COP到COP均值点的最大距离，反映极端摆动情况。突然增大可能提示失去平衡。",
         "normal": ""},
        {"name": "【压力中心最小离心】", "desc": "COP到COP均值点的最小距离。数值越小说明能够回到中心位置的能力越好。",
         "normal": ""},
        {"name": "【压力中心偏移平均速度】", "desc": "COP移动的平均速度。速度越快说明姿势调节越频繁。", "normal": ""},
        {"name": "【压力中心摆动强度】", "desc": "压力中心点偏移的均方根(RMS),综合反映摆动强度。比平均值更敏感，临床常用。",
         "normal": ""},
        {"name": "【压力中心左右方向标准差】", "desc": "左右方向位置离散度。数值越大说明左右摆动越不规律。", "normal": ""},
        {"name": "【压力中心前后方向标准差】", "desc": "前后方向位置离散度。数值越大说明前后摆动越不规律。", "normal": ""}
    ]

    # 配置参数
    title_font_size = 10
    desc_font_size = 10
    line_height = 4.5 * mm
    item_spacing = 3.5 * mm
    name_column_width = 33 * mm
    desc_column_width = W - margin * 2 - name_column_width - 20 * mm
    desc_column_x = margin + name_column_width + 20 * mm

    def smart_wrap_text(text, font, font_size, max_width):
        """智能文本换行"""
        import re
        lines = []
        current_line = ""

        # 按标点符号分割
        segments = re.split(r'([，。；:（）])', text)

        for segment in segments:
            if not segment:
                continue

            # 如果是标点符号，直接加到当前行
            if segment in "，。；:（）":
                current_line += segment
                continue

            # 处理普通文本
            for char in segment:
                test_line = current_line + char
                if c.stringWidth(test_line, font, font_size) <= max_width:
                    current_line = test_line
                else:
                    if current_line:
                        lines.append(current_line)
                    current_line = char

        if current_line:
            lines.append(current_line)

        return lines if lines else [""]

    def start_new_page(is_first=False):
        """开始新页面并返回起始Y坐标"""
        if not is_first:
            # 绘制页脚
            draw_footer_bar(c, W, FOOTER_HEIGHT_MM * mm)
            c.showPage()

        # 绘制页眉
        header_band_h = 8 * mm
        draw_slash_header(c, 0, H - header_band_h, W, header_band_h)
        date_y = draw_header_text(c, margin, W, H, "OneStep Report - 参数说明")
        draw_header_divider(c, margin, W, date_y)

        if is_first:
            # 第一页有大标题
            title_y = date_y - 16 * mm
            c.setFont(FONT_NAME, 36)
            c.setFillColor(black)
            c.drawString(margin, title_y, "注释")
            c.setFont(FONT_NAME, 12)
            c.drawString(margin, title_y - 6 * mm, "Annotation")
            return title_y - 18 * mm
        else:
            # 后续页直接从分割线下方开始
            return date_y - 8 * mm

    # 初始化第一页
    current_y = start_new_page(is_first=True)
    page_bottom = margin + FOOTER_HEIGHT_MM * mm + 10 * mm

    # 遍历所有参数
    for i, param in enumerate(parameter_explanations):
        # 准备描述文本
        full_desc = param["desc"] + (" " + param["normal"] if param["normal"] else "")
        desc_lines = smart_wrap_text(full_desc, FONT_NAME, desc_font_size, desc_column_width)

        # 计算此条目需要的总高度
        needed_height = max(line_height, len(desc_lines) * line_height) + item_spacing

        # 检查是否需要换页
        if current_y - needed_height < page_bottom:
            current_y = start_new_page(is_first=False)

        # 绘制参数名称
        c.setFont(FONT_NAME, title_font_size)
        c.setFillColor(black)
        c.drawString(margin, current_y, param["name"])

        # 绘制描述内容
        c.setFont(FONT_NAME, desc_font_size)
        c.setFillColor(HexColor("#666666"))

        desc_y = current_y
        for line in desc_lines:
            c.drawString(desc_column_x, desc_y, line)
            desc_y -= line_height

        # 更新Y坐标
        current_y -= needed_height

    # 绘制最后一页的页脚
    draw_footer_bar(c, W, FOOTER_HEIGHT_MM * mm)


# ========== 主入口 ==========

def generate_report_from_json(json_path):
    """读取JSON，根据其中路径生成最终PDF"""
    if not os.path.exists(json_path):
        print(f"Error: JSON file not found at {json_path}")
        return None

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    output_pdf = str(os.path.splitext(json_path)[0]) + "OneStepReport.pdf"

    c = canvas.Canvas(output_pdf, pagesize=A4)
    W, H = A4
    margin = 18 * mm

    # 第1页
    page1(c, W, H, margin, data)
    c.showPage()

    # 第2页
    page2(c, W, H, margin, data)
    c.showPage()

    # 第3页
    page3(c, W, H, margin, data)
    c.showPage()

    # 第4页及后续页（自动分页）
    page4(c, W, H, margin)
    # ⚠️ 注意：不要在这里调用 c.showPage()

    c.save()
    print(f"Report generated successfully!")
    return output_pdf

if __name__ == "__main__":
    # 测试用：你需要先运行 script 1 生成一个 json 文件
    generate_report_from_json(r"C:\Users\xpr12\Desktop\OneStep_report_20251218.json")

"""
集中式布局配置模块
==================
所有页面布局参数集中管理,方便统一调整
"""

from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape

class LayoutConfig:
    """布局配置类 - 集中管理所有页面布局参数"""
    
    # ==================== 页面基础设置 ====================
    PAGE_SIZE = landscape(A4)  # A4横向: 29.7cm × 21cm
    PAGE_WIDTH = PAGE_SIZE[0]
    PAGE_HEIGHT = PAGE_SIZE[1]
    
    # 页边距
    MARGIN_LEFT = 1.5 * cm
    MARGIN_RIGHT = 1.5 * cm
    MARGIN_TOP = 1.2 * cm
    MARGIN_BOTTOM = 1.0 * cm
    
    # 可用内容区域
    CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
    CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
    
    # ==================== 颜色方案 ====================
    COLOR_BLACK = colors.black
    COLOR_WHITE = colors.white
    COLOR_BLUE = colors.HexColor('#1E90FF')  # 蓝色链接
    COLOR_GRAY_LIGHT = colors.HexColor('#E8E8E8')  # 浅灰色
    COLOR_GRAY_BORDER = colors.HexColor('#CCCCCC')  # 边框灰色
    
    # ==================== 字体设置 ====================
    FONT_NAME = 'STSong-Light'  # 默认字体
    FONT_SIZE_TITLE = 18
    FONT_SIZE_SUBTITLE = 14
    FONT_SIZE_LABEL = 12
    FONT_SIZE_DATA = 16
    FONT_SIZE_NORMAL = 12
    
    # ==================== 第1页和第3页布局 (Stand/Sit演变页) ====================
    class HeaderLayout:
        """页眉布局配置"""
        # 主标题
        TITLE_Y = 19 * cm  # 距离页面底部的Y坐标
        TITLE_FONT_SIZE = 18
        
        # 链接
        LINK_Y = 19 * cm
        LINK_FONT_SIZE = 14
        
        # 黑色标签 "站-坐-站"
        LABEL_X = 1.5 * cm
        LABEL_Y = 17.85 * cm
        LABEL_WIDTH = 2.5 * cm
        LABEL_HEIGHT = 0.7 * cm
        LABEL_FONT_SIZE = 14
        LABEL_RADIUS = 2 * mm  # 圆角半径
        
        # 副标题文字
        SUBTITLE_X = LABEL_X + LABEL_WIDTH + 0.3 * cm
        SUBTITLE_Y = 18 * cm
        SUBTITLE_FONT_SIZE = 14
        
        # 数据指标框
        METRICS_Y = 15.8 * cm  # 指标框底部Y坐标
        METRICS_BOX_WIDTH = 8.7 * cm
        METRICS_BOX_HEIGHT = 1.5 * cm
        METRICS_TITLE_HEIGHT = 0.7 * cm
        METRICS_DATA_HEIGHT = 1.0 * cm
        METRICS_SPACING = 0.3 * cm  # 框间距
        METRICS_TITLE_FONT_SIZE = 14
        METRICS_DATA_FONT_SIZE = 16
        METRICE_RADIUS = 2 * mm  # 圆角半径
        
    class EvolutionLayout:
        """演变图布局配置"""
        # 主内容区边框
        BORDER_X = 1.5 * cm
        BORDER_Y = 1.5 * cm
        BORDER_WIDTH = 26.7 * cm
        BORDER_HEIGHT = 13.5 * cm
        BORDER_RADIUS = 5 * mm
        BORDER_LINE_WIDTH = 1.5
        
        # 内容标题 "周期内脚底压力变化 (站-坐-站)"
        CONTENT_TITLE_X = BORDER_X + 0.5 * cm
        CONTENT_TITLE_Y = BORDER_Y + BORDER_HEIGHT - 0.8 * cm
        CONTENT_TITLE_FONT_SIZE = 14
        
        # 热力图网格起始位置
        GRID_X = BORDER_X + 0.5 * cm
        GRID_Y = BORDER_Y + 2.0 * cm
        GRID_WIDTH = BORDER_WIDTH - 1.0 * cm
        GRID_HEIGHT = BORDER_HEIGHT - 2 * cm  # 减小上方间距
        
        # Stand页面: 2行 × 12列 (第1列为标签)
        STAND_ROWS = 2
        STAND_COLS = 12
        STAND_LABEL_COL_WIDTH = 1.8 * cm  # 标签列宽度
        STAND_CELL_WIDTH = (GRID_WIDTH - STAND_LABEL_COL_WIDTH) / (STAND_COLS - 1)
        STAND_CELL_HEIGHT = GRID_HEIGHT / STAND_ROWS - 1 * cm
        
        # Sit页面: 1行 × 11列
        SIT_ROWS = 1
        SIT_COLS = 11
        SIT_CELL_WIDTH = GRID_WIDTH / SIT_COLS
        SIT_CELL_HEIGHT = GRID_HEIGHT - 8.8 * cm
        
        # 单元格间距
        CELL_SPACING = 2 * mm
        
        # 标签样式
        LABEL_FONT_SIZE = 12
        LABEL_BG_COLOR = colors.black
        LABEL_TEXT_COLOR = colors.white
        
        # 列标题样式 (0%, 10%, ...)
        COL_TITLE_FONT_SIZE = 11
        COL_TITLE_BG_COLOR = colors.HexColor('#D3D3D3')
        COL_TITLE_PADDING = 3 * mm
        
    # ==================== 第2页和第4页布局 (COP曲线页) ====================
    class COPLayout:
        """COP曲线页布局配置"""
        # 页面标题 "平均压力&COP曲线"
        PAGE_TITLE_Y = 18.5 * cm
        PAGE_TITLE_FONT_SIZE = 18
        
        # Stand COP (第2页): 左右两栏
        STAND_COL_SPACING = 0.5 * cm  # 两栏间距
        STAND_COL_WIDTH = 13.0 * cm   # 单栏宽度
        
        STAND_LEFT_X = 1.5 * cm
        STAND_LEFT_Y = 2.0 * cm
        STAND_LEFT_WIDTH = STAND_COL_WIDTH
        STAND_LEFT_HEIGHT = 15.0 * cm
        
        STAND_RIGHT_X = STAND_LEFT_X + STAND_COL_WIDTH + STAND_COL_SPACING
        STAND_RIGHT_Y = 2.0 * cm
        STAND_RIGHT_WIDTH = STAND_COL_WIDTH
        STAND_RIGHT_HEIGHT = 15.0 * cm
        
        # 栏标题 "左脚COP曲线" / "右脚COP曲线"
        COL_TITLE_HEIGHT = 0.8 * cm
        COL_TITLE_FONT_SIZE = 16
        COL_TITLE_BG_COLOR = colors.black
        COL_TITLE_TEXT_COLOR = colors.white
        
        # Sit COP (第4页): 单个大图
        SIT_X = 1.5 * cm
        SIT_Y = 2.0 * cm
        SIT_WIDTH = 26.7 * cm  # 与第1、3页的内容区宽度一致
        SIT_HEIGHT = 15.5 * cm
        
        # 图例位置
        LEGEND_FONT_SIZE = 11
        LEGEND_BG_COLOR = colors.black
        LEGEND_TEXT_COLOR = colors.white
        
        # 边框样式
        BORDER_LINE_WIDTH = 2
        BORDER_COLOR = colors.black
        
    # ==================== 图像生成配置 ====================
    class ImageConfig:
        """图像生成参数配置"""
        # 热力图平滑参数
        UPSCALE_FACTOR = 10
        SIGMA = 0.8
        
        # 颜色映射
        HEATMAP_CMAP = 'jet'
        COP_CMAP = 'spring'
        
        # COP轨迹样式
        COP_LINE_WIDTH = 2.5
        COP_LINE_ALPHA = 0.9
        COP_START_MARKER_SIZE = 30
        COP_START_MARKER_COLOR = 'white'
        COP_START_MARKER_EDGE_WIDTH = 2
        
        # DPI设置
        DPI = 300
        
        # 图像背景色
        FIG_FACECOLOR = 'white'
        AXES_FACECOLOR = 'black'
        
    # ==================== 辅助方法 ====================
    @classmethod
    def get_metrics_box_positions(cls):
        """获取三个数据指标框的位置"""
        positions = []
        for i in range(3):
            x = cls.MARGIN_LEFT + i * (cls.HeaderLayout.METRICS_BOX_WIDTH + cls.HeaderLayout.METRICS_SPACING)
            y = cls.HeaderLayout.METRICS_Y
            positions.append((x, y))
        return positions
    
    @classmethod
    def get_stand_cell_position(cls, row, col):
        """获取Stand演变图中指定单元格的位置
        
        Args:
            row: 行索引 (0或1)
            col: 列索引 (0-11, 0为标签列)
        
        Returns:
            (x, y, width, height)
        """
        if col == 0:
            # 标签列
            x = cls.EvolutionLayout.GRID_X
            width = cls.EvolutionLayout.STAND_LABEL_COL_WIDTH
        else:
            # 热力图列
            x = cls.EvolutionLayout.GRID_X + cls.EvolutionLayout.STAND_LABEL_COL_WIDTH + \
                (col - 1) * cls.EvolutionLayout.STAND_CELL_WIDTH
            width = cls.EvolutionLayout.STAND_CELL_WIDTH
        
        y = cls.EvolutionLayout.GRID_Y + (cls.EvolutionLayout.STAND_ROWS - 1 - row) * \
            cls.EvolutionLayout.STAND_CELL_HEIGHT
        height = cls.EvolutionLayout.STAND_CELL_HEIGHT
        
        return (x, y, width - cls.EvolutionLayout.CELL_SPACING, 
                height - cls.EvolutionLayout.CELL_SPACING)
    
    @classmethod
    def get_sit_cell_position(cls, col):
        """获取Sit演变图中指定单元格的位置
        
        Args:
            col: 列索引 (0-10)
        
        Returns:
            (x, y, width, height)
        """
        x = cls.EvolutionLayout.GRID_X + col * cls.EvolutionLayout.SIT_CELL_WIDTH
        y = cls.EvolutionLayout.GRID_Y
        width = cls.EvolutionLayout.SIT_CELL_WIDTH - cls.EvolutionLayout.CELL_SPACING
        height = cls.EvolutionLayout.SIT_CELL_HEIGHT - cls.EvolutionLayout.CELL_SPACING
        
        return (x, y, width, height)


# ==================== 预设配置 ====================
# 可以根据需要创建不同的配置预设

class CompactLayoutConfig(LayoutConfig):
    """紧凑布局配置 (更小的间距)"""
    MARGIN_LEFT = 1.0 * cm
    MARGIN_RIGHT = 1.0 * cm
    
    class EvolutionLayout(LayoutConfig.EvolutionLayout):
        CELL_SPACING = 1 * mm


class LargeLayoutConfig(LayoutConfig):
    """大字体布局配置 (适合打印)"""
    FONT_SIZE_TITLE = 20
    FONT_SIZE_SUBTITLE = 16
    FONT_SIZE_DATA = 18
    
    class HeaderLayout(LayoutConfig.HeaderLayout):
        TITLE_FONT_SIZE = 20
        METRICS_DATA_FONT_SIZE = 18


# 导出默认配置
DEFAULT_CONFIG = LayoutConfig

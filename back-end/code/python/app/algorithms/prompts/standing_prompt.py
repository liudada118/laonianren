"""
Standing assessment prompt definitions.
"""


STANDING_SYSTEM_PROMPT = """你是一位专业的足底压力与平衡功能评估AI助手，专注于静态站立测试结果的解读。

你的任务是根据结构化的静态站立指标，生成一份中文分析报告，帮助临床人员、老人及家属理解足弓状态、左右受力平衡和站立稳定性。

## 参考原则
- 足弓指数常见经验范围：
  - 约 0.21 ~ 0.26：多可视作正常足弓
  - <0.21：倾向高足弓
  - >0.26：倾向扁平足
- 左右压力分布越接近越平衡；明显偏侧提示代偿、疼痛回避或姿势控制问题
- COP（压力中心）路径越长、速度越快、摆动越大，通常说明稳定性越差

## 评估维度
1. 足弓结构：左右足弓指数、是否偏高或偏低
2. 受力平衡：左右压力占比、区域压力分布
3. 站立稳定性：COP 轨迹长度、平均速度、位移范围、椭圆面积等
4. 功能风险：是否提示平衡控制下降或跌倒风险增加

## 数据质量判断
当出现以下情况时，请在 data_quality 中提示：
- 左右总受力都很低或接近 0
- 左右任一关键指标缺失严重
- COP 指标缺失或明显异常
- 左右压力占比极端失衡且不符合常理

## 输出要求
1. 语言为中文
2. 专业但通俗易懂
3. 严格输出 JSON，不要带 markdown 代码块
4. 不要把结果表述成最终医学诊断，使用“提示”“倾向”“建议进一步评估”等措辞
"""


def build_standing_user_prompt(patient_info: dict, standing_data: dict) -> str:
    name = patient_info.get("name", "未知")
    gender = patient_info.get("gender", "未知")
    age = patient_info.get("age", "未知")
    weight = patient_info.get("weight", "未知")

    bilateral = standing_data.get("bilateral", {}) or {}
    overall_cop = standing_data.get("overall_cop", {}) or {}
    left_cop = standing_data.get("left_cop", {}) or {}
    right_cop = standing_data.get("right_cop", {}) or {}
    cop_results = standing_data.get("cop_results", {}) or {}

    return f"""请根据以下静态站立评估数据生成分析报告。

## 患者信息
- 姓名: {name}
- 性别: {gender}
- 年龄: {age}
- 体重: {weight}kg

## 足弓与受力信息
- 左足足弓指数: {standing_data.get('left_arch_index', '未知')}
- 右足足弓指数: {standing_data.get('right_arch_index', '未知')}
- 平均足弓指数: {standing_data.get('average_arch_index', '未知')}
- 左足总接触面积: {standing_data.get('left_total_area', '未知')} cm²
- 右足总接触面积: {standing_data.get('right_total_area', '未知')} cm²
- 左足区域压力: {standing_data.get('left_region_pressure', {})}
- 右足区域压力: {standing_data.get('right_region_pressure', {})}

## 左右平衡
- 左脚压力占比: {bilateral.get('left_pressure_ratio', '未知')}%
- 右脚压力占比: {bilateral.get('right_pressure_ratio', '未知')}%
- 左右压力差: {bilateral.get('pressure_diff', '未知')}%
- 平衡状态: {standing_data.get('balance_status', '未知')}

## COP 稳定性
- 整体 COP 指标: {overall_cop}
- 左脚 COP 指标: {left_cop}
- 右脚 COP 指标: {right_cop}
- 其他 COP 结果: {cop_results}

请严格按以下 JSON 格式返回，不要添加任何额外文本：
{{
  "data_quality": {{
    "is_valid": true或false,
    "issues": ["列出数据质量问题，没有则返回空数组"],
    "suggestion": "如果存在异常，给出重测建议；否则为null"
  }},
  "eval_level": {{
    "text": "正常/需关注/异常",
    "standard": "依据足弓、压力平衡和COP稳定性综合判断"
  }},
  "overview": "整体测试概况与关键发现总结",
  "arch_analysis": "左右足弓结构与受力形态分析",
  "pressure_balance_analysis": "左右受力平衡与区域压力分布分析",
  "stability_analysis": "基于COP指标的站立稳定性分析",
  "clinical_suggestion": "训练建议、鞋垫/姿势建议与复查建议",
  "disclaimer": "本报告由AI辅助生成，仅供参考，最终判断请结合临床专业意见"
}}
"""

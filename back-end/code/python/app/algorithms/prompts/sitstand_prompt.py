"""
Sit-stand assessment prompt definitions.
"""


SITSTAND_SYSTEM_PROMPT = """你是一位专业的老年医学与康复评估AI助手，专注于五次起坐测试（Five Times Sit-to-Stand Test, 5xSTS）的结果解读。

你的任务是根据结构化的起坐评估指标，生成一份专业、客观、易懂的中文分析报告。

## 参考标准
- EWGSOP2：五次起坐总时长 >15 秒，提示下肢肌力或功能下降，需要进一步关注肌少症风险。
- 临床经验可将总时长大致分层：
  - <12 秒：表现较好
  - 12~15 秒：基本正常
  - 15~20 秒：偏慢，提示功能下降风险
  - >20 秒：明显异常，建议进一步评估

## 评估维度
1. 总体完成效率：总时长、平均周期时长、是否完成足够周期
2. 周期稳定性：各次起坐周期是否一致，是否存在明显波动
3. 左右受力对称性：是否存在明显偏侧代偿
4. 力学表现：脚垫/坐垫压力峰值、平均力、变化率是否合理
5. 功能风险：是否提示下肢力量下降、起立控制能力不足或跌倒风险增加

## 数据质量判断
当出现以下情况时，请在 data_quality 中明确提示：
- 总时长 <= 0 或明显异常
- 完整周期数过少（如 <3）
- 站立峰值数量明显不足
- 对称性极低或关键指标大量缺失
- 力值接近 0 或变化极不合理，怀疑采集异常

## 输出要求
1. 语言必须为中文
2. 适合老年人及家属阅读，但保持专业性
3. 必须严格输出 JSON，不要输出 markdown 代码块
4. 即使数据质量一般，也要先提示问题，再基于现有数据给出参考分析
"""


def build_sitstand_user_prompt(patient_info: dict, sitstand_data: dict) -> str:
    name = patient_info.get("name", "未知")
    gender = patient_info.get("gender", "未知")
    age = patient_info.get("age", "未知")
    weight = patient_info.get("weight", "未知")

    duration_stats = sitstand_data.get("duration_stats", {}) or {}
    pressure_stats = sitstand_data.get("pressure_stats", {}) or {}
    symmetry = sitstand_data.get("symmetry", {}) or {}
    seat_stats = sitstand_data.get("seat_stats", {}) or {}
    footpad_stats = sitstand_data.get("footpad_stats", {}) or {}
    cycle_peak_forces = sitstand_data.get("cycle_peak_forces", []) or []
    sit_peaks = sitstand_data.get("sit_peaks", sitstand_data.get("stand_peaks", 0))
    sitstand_data = {**sitstand_data, "stand_peaks": sit_peaks}

    return f"""请根据以下起坐评估数据生成分析报告。

## 患者信息
- 姓名: {name}
- 性别: {gender}
- 年龄: {age}
- 体重: {weight}kg

## 起坐评估数据
- 总时长: {duration_stats.get('total_duration', 0)}s
- 完整周期数: {duration_stats.get('num_cycles', 0)}
- 平均周期时长: {duration_stats.get('avg_duration', 0)}s
- 最短周期时长: {duration_stats.get('min_cycle_duration', 0)}s
- 最长周期时长: {duration_stats.get('max_cycle_duration', 0)}s
- 各周期时长: {duration_stats.get('cycle_durations', [])}
- 检测到的站立峰值数: {sitstand_data.get('stand_peaks', 0)}
- 各周期峰值力: {cycle_peak_forces}

## 对称性
- 左右对称性指数: {symmetry.get('left_right_ratio', '未知')}%
- 左侧平均受力: {symmetry.get('left_avg_force', '未知')}
- 右侧平均受力: {symmetry.get('right_avg_force', '未知')}

## 压力统计
- 脚垫最大总力: {pressure_stats.get('foot_max', 0)}
- 脚垫平均总力: {pressure_stats.get('foot_avg', 0)}
- 脚垫最大变化率: {pressure_stats.get('max_foot_change_rate', 0)}
- 坐垫最大总力: {pressure_stats.get('sit_max', 0)}
- 坐垫平均总力: {pressure_stats.get('sit_avg', 0)}
- 坐垫最大变化率: {pressure_stats.get('max_sit_change_rate', 0)}

## 设备统计
- 坐垫最大压力: {seat_stats.get('max_pressure', '未知')}
- 坐垫平均压力: {seat_stats.get('mean_pressure', '未知')}
- 坐垫接触面积: {seat_stats.get('contact_area', '未知')}
- 脚垫最大压力: {footpad_stats.get('max_pressure', '未知')}
- 脚垫平均压力: {footpad_stats.get('mean_pressure', '未知')}
- 脚垫接触面积: {footpad_stats.get('contact_area', '未知')}

请严格按以下 JSON 格式返回，不要添加任何额外文本：
{{
  "data_quality": {{
    "is_valid": true或false,
    "issues": ["列出数据质量问题，没有则返回空数组"],
    "suggestion": "如果存在异常，给出重测或补采建议；否则为null"
  }},
  "eval_level": {{
    "text": "优秀/正常/偏慢/异常",
    "standard": "依据的判断标准说明"
  }},
  "overview": "整体测试概况与关键数字总结（90~120字）",
  "performance_analysis": "总时长、周期效率、起坐完成能力分析，结合标准分层评价功能水平（90~120字）",
  "symmetry_analysis": "左右受力对称性与可能代偿分析，推断是否存在偏侧依赖或保护性策略（90~120字）",
  "force_analysis": "压力变化趋势、各周期峰值力波动、起立控制能力分析（90~120字）",
  "clinical_suggestion": "具体训练建议与随访建议",
  "disclaimer": "本报告由AI辅助生成，仅供参考，最终判断请结合临床专业意见"
}}
"""

"""
Gait assessment prompt definitions.
"""


GAIT_SYSTEM_PROMPT = """你是一位专业的步态分析与老年功能评估AI助手，专注于步态时空参数、对称性和稳定性结果的解读。

你的任务是根据结构化步态评估指标，生成一份中文分析报告。

## 参考原则
- 步速是老年功能状态的重要指标：
  - >= 1.0 m/s：通常较好
  - 0.8 ~ 1.0 m/s：可接受，但需结合其他指标
  - < 0.8 m/s：提示功能下降或跌倒风险增加
- 左右步长、步时明显不对称，提示步态代偿或稳定性问题
- 足偏角（FPA）偏离过大，提示步态姿势异常风险
- 双支撑时间增大，常提示谨慎步态、平衡控制下降或下肢功能不足

## 评估维度
1. 步态效率：步速、步长、步宽
2. 对称性：左右步时、步长、支撑阶段是否协调
3. 姿势特征：足偏角是否异常
4. 平衡与稳定性：双支撑时间、支撑相和周期相表现
5. 功能风险：是否提示跌倒风险增加或步态异常

## 数据质量判断
当出现以下情况时，请在 data_quality 中提示：
- 关键时空参数大面积缺失
- 步速为 0 或明显不合理
- 左右参数差异异常大，疑似采集或识别异常
- 支撑相/周期相数据缺失严重

## 输出要求
1. 语言为中文
2. 严格输出 JSON，不要带 markdown 代码块
3. 保持专业客观，但让非专业人士也能理解
4. 不要给出最终诊断，用“提示”“建议进一步评估”等措辞
"""


def build_gait_user_prompt(patient_info: dict, gait_data: dict) -> str:
    name = patient_info.get("name", "未知")
    gender = patient_info.get("gender", "未知")
    age = patient_info.get("age", "未知")
    weight = patient_info.get("weight", "未知")

    return f"""请根据以下步态评估数据生成分析报告。

## 患者信息
- 姓名: {name}
- 性别: {gender}
- 年龄: {age}
- 体重: {weight}kg

## 步态时空参数
- 步速: {gait_data.get('walking_speed', '未知')} m/s
- 左步时: {gait_data.get('left_step_time', '未知')} s
- 右步时: {gait_data.get('right_step_time', '未知')} s
- 步时差: {gait_data.get('step_time_diff', '未知')} s
- 左步长: {gait_data.get('left_step_length', '未知')} cm
- 右步长: {gait_data.get('right_step_length', '未知')} cm
- 步长差: {gait_data.get('step_length_diff', '未知')} cm
- 步宽: {gait_data.get('step_width', '未知')} cm
- 左足偏角 FPA: {gait_data.get('left_fpa', '未知')} °
- 右足偏角 FPA: {gait_data.get('right_fpa', '未知')} °
- 双支撑时间: {gait_data.get('double_contact_time', '未知')} s

## 平衡与支撑特征
- 平衡摘要: {gait_data.get('balance_summary', {})}
- 支撑相摘要: {gait_data.get('support_phase_summary', {})}
- 步态周期摘要: {gait_data.get('cycle_phase_summary', {})}
- 足偏角异常步数统计: {gait_data.get('fpa_outlier_summary', {})}

请严格按以下 JSON 格式返回，不要添加任何额外文本：
{{
  "data_quality": {{
    "is_valid": true或false,
    "issues": ["列出数据质量问题，没有则返回空数组"],
    "suggestion": "如果存在异常，给出重测建议；否则为null"
  }},
  "eval_level": {{
    "text": "正常/需关注/异常",
    "standard": "依据步速、对称性、足偏角与支撑稳定性综合判断"
  }},
  "overview": "整体步态概况与关键发现总结",
  "spatiotemporal_analysis": "步速、步长、步时等时空参数分析",
  "symmetry_analysis": "左右对称性与可能代偿分析",
  "posture_analysis": "足偏角和步态姿势特征分析",
  "stability_analysis": "平衡、双支撑时间、支撑相和步态稳定性分析",
  "clinical_suggestion": "训练建议、复查建议和风险提示",
  "disclaimer": "本报告由AI辅助生成，仅供参考，最终判断请结合临床专业意见"
}}
"""

"""
基于发货数据查询.mk 改造为中试生产助手.mk

改造内容：
1. 名称/描述/欢迎语改为中试生产助手
2. 删除 SAP 相关节点（tool-lib-node 发货数据获取、parameter-extraction-node 参数提取）
3. 简化工作流为：start-node → ai-chat-node → reply-node
4. ai-chat-node 的 prompt 改为 {{开始.question}}，清空 system（agent 自带 AGENTS.md 系统提示词）
5. 清空 base-node 的 api_input_field_list 和 user_input_field_list（无 SAP 业务参数）
6. 清理 start-node.globalFields 中的 SAP 业务字段
7. 生成新的 application id（避免与原 agent 冲突）
8. 调大 max_tokens（800→4096），降低 temperature（0.7→0.3，让回复更稳定）
"""
import pickle
import sys
import types
import uuid
from datetime import datetime, timezone, timedelta


class MKInstance:
    pass


# 注入桩模块
sys.modules["application"] = types.ModuleType("application")
sys.modules["application.serializers"] = types.ModuleType("application.serializers")
mod = types.ModuleType("application.serializers.application")
mod.MKInstance = MKInstance
sys.modules["application.serializers.application"] = mod

# 关键修复：让 pickle 序列化时写入正确的模块路径
# 否则会写入 __main__.MKInstance，MaxKB 加载时找不到类
MKInstance.__module__ = "application.serializers.application"

SRC = r"C:\Users\K027932\Downloads\发货数据查询.mk"
DST = r"d:\AIAgent\production_agent\maxkb\中试生产助手.mk"

# === 1. 加载原 .mk ===
with open(SRC, "rb") as f:
    obj = pickle.load(f)

app = obj.__dict__["application"]
wf = app["work_flow"]

# === 2. 改 application 顶层字段 ===
app["id"] = str(uuid.uuid4())  # 新 UUID，避免冲突
app["name"] = "中试生产进度查询"
app["desc"] = "中试车间智能生产助手 - 输入订单号即可查询生产进度、负责人、完成时间、异常信息"
app["prologue"] = (
    "您好，我是中试生产助手，可以向您提供以下服务：\n"
    "- 查询订单进度：输入订单号即可查询各工序负责人、完成时间、异常信息\n"
    "- 多维订单查询：按技术员、业务类型别名（研发实验 / 工艺实验 / 注塑单等）、基地、排产时间范围查询订单列表\n"
    "- 搜索订单：用客户名/产品名模糊查找订单号\n"
    "- 了解生产工序：询问\"生产有哪些工序\"\n"
    "- 产能负荷分析：询问\"哪个基地负荷低\"\n"
    "- 下单基地推荐：询问\"推荐去哪个基地下单\"\n"
    "- 交期估算：询问\"在 XX 基地下单要多久\"\n\n"
    "支持业务范围：广州工艺实验 / 广州送样&小订单 / 小试（全集团）/ 上海工艺实验 / OA辅助单（全集团）"
)
app["is_publish"] = False  # 导入后需手动发布

# === 3. 改 base-node 基本信息 ===
base_node = next(n for n in wf["nodes"] if n["type"] == "base-node")
base_node["properties"]["node_data"]["name"] = "中试生产进度查询"
base_node["properties"]["node_data"]["desc"] = app["desc"]
base_node["properties"]["node_data"]["prologue"] = app["prologue"]
# 清空 SAP 业务参数
base_node["properties"]["api_input_field_list"] = []
base_node["properties"]["user_input_field_list"] = []

# === 4. 清理 start-node.globalFields（删除 org/kf/s/e/mr SAP 字段）===
start_node = next(n for n in wf["nodes"] if n["type"] == "start-node")
KEEP_GLOBAL = {"time", "history_context", "chat_id",
               "chat_user_id", "chat_user_type", "chat_user_group", "chat_user"}
start_node["properties"]["globalFields"] = [
    {"label": "当前时间", "value": "time"},
    {"label": "历史聊天记录", "value": "history_context"},
    {"label": "对话 ID", "value": "chat_id"},
    {"label": "对话用户 ID", "value": "chat_user_id"},
    {"label": "对话用户类型", "value": "chat_user_type"},
    {"label": "对话用户组", "value": "chat_user_group"},
    {"label": "对话用户", "value": "chat_user"},
]
start_node["properties"]["config"]["globalFields"] = start_node["properties"]["globalFields"]

# === 5. 改 ai-chat-node ===
ai_chat_node = next(n for n in wf["nodes"] if n["type"] == "ai-chat-node")
ai_node_data = ai_chat_node["properties"]["node_data"]
ai_node_data["prompt"] = "{{开始.question}}"  # 直接转发用户问题给 production-agent
ai_node_data["system"] = ""  # 清空，agent 自带 AGENTS.md 系统提示词
# 调大 token 限制（订单进度回复可能较长）
ai_node_data["model_params_setting"]["max_tokens"] = 4096
ai_node_data["model_params_setting"]["temperature"] = 0.3
# model_id 保留原值（用户导入后需手动重新选择 production-agent 模型）

# === 6. 删除 SAP 相关节点 ===
REMOVE_TYPES = {"tool-lib-node", "parameter-extraction-node"}
wf["nodes"] = [n for n in wf["nodes"] if n["type"] not in REMOVE_TYPES]

# === 7. 重写 edges：start-node → ai-chat-node → reply-node ===
ai_chat_id = ai_chat_node["id"]
reply_node = next(n for n in wf["nodes"] if n["type"] == "reply-node")
reply_id = reply_node["id"]


def make_edge(src, dst):
    return {
        "id": str(uuid.uuid4()),
        "type": "app-edge",
        "endPoint": {"x": 0, "y": 0},
        "pointsList": [],
        "properties": {},
        "startPoint": {"x": 0, "y": 0},
        "sourceNodeId": src,
        "targetNodeId": dst,
        "sourceAnchorId": f"{src}_right",
        "targetAnchorId": f"{dst}_left",
    }


wf["edges"] = [
    make_edge("start-node", ai_chat_id),
    make_edge(ai_chat_id, reply_id),
]

# === 8. tool_list 已是空（无外部工具）—— 不动 ===

# === 9. 写出新 .mk ===
import os
os.makedirs(os.path.dirname(DST), exist_ok=True)
with open(DST, "wb") as f:
    pickle.dump(obj, f, protocol=4)

print(f"✅ 已生成: {DST}")
print(f"   文件大小: {os.path.getsize(DST)} 字节")

# === 10. 验证：重新加载检查 ===
with open(DST, "rb") as f:
    verify = pickle.load(f)
v_app = verify.__dict__["application"]
print("\n=== 验证 ===")
print(f"name:       {v_app['name']}")
print(f"desc:       {v_app['desc'][:50]}...")
print(f"id:         {v_app['id']}")
print(f"is_publish: {v_app['is_publish']}")
print(f"nodes:")
for n in v_app["work_flow"]["nodes"]:
    nd = n["properties"].get("node_data", {})
    extra = ""
    if "prompt" in nd:
        extra = f"  prompt={nd['prompt']!r}"
    if "name" in nd:
        extra = f"  name={nd['name']!r}"
    print(f"  - {n['type']:20s} {extra}")
print(f"edges:")
for e in v_app["work_flow"]["edges"]:
    print(f"  {e['sourceNodeId']:40s} -> {e['targetNodeId']}")

ai = next(n for n in v_app["work_flow"]["nodes"] if n["type"] == "ai-chat-node")
print(f"\nai-chat-node:")
print(f"  prompt:         {ai['properties']['node_data']['prompt']!r}")
print(f"  system:         {ai['properties']['node_data']['system']!r}")
print(f"  max_tokens:     {ai['properties']['node_data']['model_params_setting']['max_tokens']}")
print(f"  temperature:    {ai['properties']['node_data']['model_params_setting']['temperature']}")
print(f"  model_id:       {ai['properties']['node_data']['model_id']}")
print(f"  (model_id 是原 SAP agent 的，导入后需手动改为 production-agent)")

base = next(n for n in v_app["work_flow"]["nodes"] if n["type"] == "base-node")
print(f"\nbase-node:")
print(f"  api_input_field_list:  {len(base['properties']['api_input_field_list'])} 项")
print(f"  user_input_field_list: {len(base['properties']['user_input_field_list'])} 项")

print("\n✅ 验证通过")

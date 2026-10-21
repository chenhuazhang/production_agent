"""探查关键节点详细结构"""
import pickle
import sys
import types
import json
from datetime import datetime
from uuid import UUID


class MKInstance:
    pass


sys.modules["application"] = types.ModuleType("application")
sys.modules["application.serializers"] = types.ModuleType("application.serializers")
mod = types.ModuleType("application.serializers.application")
mod.MKInstance = MKInstance
sys.modules["application.serializers.application"] = mod


def default_serializer(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, bytes):
        return f"<bytes len={len(obj)}>"
    return f"<{type(obj).__name__}>"


with open(r"C:\Users\K027932\Downloads\发货数据查询.mk", "rb") as f:
    obj = pickle.load(f)

app = obj.__dict__["application"]

# 打印 base-node、start-node、ai-chat-node、reply-node 的完整结构
TARGET_TYPES = {"base-node", "start-node", "ai-chat-node", "reply-node"}
for n in app["work_flow"]["nodes"]:
    if n["type"] in TARGET_TYPES:
        print(f"\n========== {n['type']} ==========")
        print(json.dumps(n, indent=2, ensure_ascii=False, default=default_serializer))

"""探查 .mk 文件结构（pickle 反序列化）"""
import pickle
import sys
import types
import json
from datetime import datetime
from uuid import UUID


class MKInstance:
    pass


# 注入桩模块，让 pickle 能找到 MKInstance 类
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

print("=== 顶层类型 ===")
print(type(obj).__name__)
print(obj.__dict__.keys() if hasattr(obj, "__dict__") else "no __dict__")

app = obj.__dict__["application"]
print("\n=== application 字段 ===")
for k, v in app.items():
    t = type(v).__name__
    if isinstance(v, str):
        preview = v[:80] + "..." if len(v) > 80 else v
        print(f"  {k}: {t} = {preview!r}")
    elif isinstance(v, (list, dict)):
        print(f"  {k}: {t} (len={len(v)})")
    else:
        print(f"  {k}: {t} = {v!r}")

print("\n=== work_flow.nodes ===")
for n in app["work_flow"]["nodes"]:
    print(f"  - type={n['type']:30s} id={n['id']}")
    nd = n.get("node_data", {})
    if "stepName" in nd:
        print(f"      stepName={nd['stepName']}")
    if "name" in nd:
        print(f"      name={nd['name']}")
    if "prompt" in nd:
        print(f"      prompt={(nd['prompt'] or '')[:100]!r}")
    if "system" in nd:
        print(f"      system={(nd['system'] or '')[:80]!r}")
    if "model_id" in nd:
        print(f"      model_id={nd['model_id']}")

print("\n=== work_flow.edges ===")
for e in app["work_flow"]["edges"]:
    print(f"  {e['sourceNodeId'][:8]}... -> {e['targetNodeId'][:8]}...")

print("\n=== tool_list ===")
for t in app.get("tool_list", []):
    print(f"  - name={t.get('name')} id={t.get('id')}")

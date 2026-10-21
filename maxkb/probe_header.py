"""对比原始 .mk 与新生成 .mk 的二进制头部，找出格式差异"""
import pickle
import sys
import types


class MKInstance:
    pass


sys.modules["application"] = types.ModuleType("application")
sys.modules["application.serializers"] = types.ModuleType("application.serializers")
mod = types.ModuleType("application.serializers.application")
mod.MKInstance = MKInstance
sys.modules["application.serializers.application"] = mod

SRC = r"C:\Users\K027932\Downloads\发货数据查询.mk"
DST = r"d:\AIAgent\production_agent\maxkb\中试生产助手.mk"

# 1. 读原始字节
with open(SRC, "rb") as f:
    src_bytes = f.read()
with open(DST, "rb") as f:
    dst_bytes = f.read()

print(f"=== 原始文件 ===")
print(f"大小: {len(src_bytes)} 字节")
print(f"前 32 字节 hex: {src_bytes[:32].hex()}")
print(f"前 32 字节 raw: {src_bytes[:32]!r}")
print()

print(f"=== 新文件 ===")
print(f"大小: {len(dst_bytes)} 字节")
print(f"前 32 字节 hex: {dst_bytes[:32].hex()}")
print(f"前 32 字节 raw: {dst_bytes[:32]!r}")
print()

# pickle 协议 magic: 0x800x04 = protocol 4, 0x800x05 = protocol 5
print(f"=== pickle 协议分析 ===")
print(f"原始文件 protocol: {src_bytes[1]}")
print(f"新文件   protocol: {dst_bytes[1]}")
print()

# 检查是否有 gzip magic (1f 8b) 或 zip magic (50 4b)
print(f"=== 是否带压缩/包装 ===")
print(f"原始文件 gzip magic? {src_bytes[:2] == b'\\x1f\\x8b'}")
print(f"原始文件 zip magic?  {src_bytes[:2] == b'PK'}")
print(f"原始文件 pickle magic? {src_bytes[0] == 0x80}")
print()

# 2. 用不同 protocol 重新 dump，看哪个最接近原始大小
print(f"=== 用不同 pickle protocol 重新 dump 大小对比 ===")
obj = pickle.loads(src_bytes)
for p in [2, 3, 4, 5]:
    data = pickle.dumps(obj, protocol=p)
    print(f"protocol {p}: {len(data)} 字节  (原始: {len(src_bytes)})")
print()

# 3. 看原始文件用什么 protocol
print(f"=== 结论 ===")
print(f"原始文件用 protocol {src_bytes[1]}")
print(f"我生成时用了 protocol 4")
if src_bytes[1] == 4:
    print("协议一致 - 文件格式问题可能在别处")
else:
    print(f"协议不一致! 应该用 protocol {src_bytes[1]} 重新生成")

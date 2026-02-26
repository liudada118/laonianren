#!/bin/bash
# 创建7对虚拟串口
# 每对有两端：一端给模拟器写入，另一端给后端读取
# 使用socat创建PTY对

PORTS_DIR="/tmp/vserial"
mkdir -p "$PORTS_DIR"

# 清理旧进程
pkill -f "socat.*vserial" 2>/dev/null
sleep 0.5

declare -A DEVICES
DEVICES[0]="HL"       # 左手手套
DEVICES[1]="HR"       # 右手手套
DEVICES[2]="sit"      # 坐垫
DEVICES[3]="foot1"    # 脚垫1
DEVICES[4]="foot2"    # 脚垫2
DEVICES[5]="foot3"    # 脚垫3
DEVICES[6]="foot4"    # 脚垫4

for i in $(seq 0 6); do
    DEV="${DEVICES[$i]}"
    SIM_PORT="$PORTS_DIR/${DEV}_sim"
    APP_PORT="$PORTS_DIR/${DEV}_app"
    
    # 删除旧的符号链接
    rm -f "$SIM_PORT" "$APP_PORT"
    
    # 创建虚拟串口对
    socat -d -d \
        PTY,raw,echo=0,link="$SIM_PORT" \
        PTY,raw,echo=0,link="$APP_PORT" &
    
    echo "Created virtual serial pair: $SIM_PORT <-> $APP_PORT (device: $DEV)"
done

sleep 1

echo ""
echo "=== Virtual Serial Ports Created ==="
ls -la "$PORTS_DIR/"
echo ""
echo "Simulator writes to: ${PORTS_DIR}/*_sim"
echo "Backend reads from:  ${PORTS_DIR}/*_app"

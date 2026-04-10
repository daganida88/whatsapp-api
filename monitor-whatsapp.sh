#!/bin/bash
# Monitor WhatsApp containers for websocket failures and restart if needed

CONTAINERS=("whatsapp-01" "whatsapp-02" "whatsapp-03")
LOG_FILE="/var/log/whatsapp-monitor.log"
SINCE="3m"

echo "$(date '+%Y-%m-%d %H:%M:%S') Monitor check started" >> "$LOG_FILE"

for container in "${CONTAINERS[@]}"; do
    # Skip if container is not running
    if ! docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null | grep -q true; then
        continue
    fi

    # Skip if container was restarted less than 2 minutes ago (avoid restart loops)
    started_at=$(docker inspect --format='{{.State.StartedAt}}' "$container" 2>/dev/null)
    if [ -n "$started_at" ]; then
        started_ts=$(date -d "${started_at%%.*}" "+%s" 2>/dev/null)
        now_ts=$(date "+%s")
        if [ -n "$started_ts" ] && [ $((now_ts - started_ts)) -lt 120 ]; then
            continue
        fi
    fi

    # Check recent logs for websocket + (panic OR disconnected)
    recent_logs=$(docker logs --since "$SINCE" "$container" 2>&1)
    ws_lines=$(echo "$recent_logs" | grep -i "websocket" | grep -iE "panic|disconnected")

    if [ -n "$ws_lines" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [$container] Websocket failure detected, restarting..." >> "$LOG_FILE"
        echo "$ws_lines" | head -3 >> "$LOG_FILE"
        docker restart "$container" >> "$LOG_FILE" 2>&1
        echo "$(date '+%Y-%m-%d %H:%M:%S') [$container] Restarted" >> "$LOG_FILE"
    fi
done

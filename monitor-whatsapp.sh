#!/bin/bash
# Monitor WhatsApp containers for websocket failures and restart if needed

CONTAINERS=("whatsapp-01" "whatsapp-02" "whatsapp-03")
LOG_FILE="/var/log/whatsapp-monitor.log"
SINCE="3m"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

log "--- Monitor check started ---"

for container in "${CONTAINERS[@]}"; do
    # Skip if container is not running
    if ! docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null | grep -q true; then
        log "[$container] Container is not running, skipping"
        continue
    fi

    # Skip if container was restarted less than 2 minutes ago (avoid restart loops)
    started_at=$(docker inspect --format='{{.State.StartedAt}}' "$container" 2>/dev/null)
    if [ -n "$started_at" ]; then
        started_ts=$(date -d "${started_at%%.*}" "+%s" 2>/dev/null)
        now_ts=$(date "+%s")
        uptime_secs=$((now_ts - started_ts))
        if [ -n "$started_ts" ] && [ "$uptime_secs" -lt 120 ]; then
            log "[$container] Recently restarted (${uptime_secs}s ago), skipping"
            continue
        fi
    fi

    log "[$container] Checking logs from last $SINCE..."

    # Check recent logs for websocket + (panic OR disconnected)
    recent_logs=$(docker logs --since "$SINCE" "$container" 2>&1)
    ws_lines=$(echo "$recent_logs" | grep -i "websocket" | grep -iE "panic|disconnected")

    if [ -n "$ws_lines" ]; then
        error_count=$(echo "$ws_lines" | wc -l | tr -d ' ')
        log "[$container] ALERT: Found $error_count websocket error(s). Triggering restart."
        log "[$container] Error logs:"
        echo "$ws_lines" | while IFS= read -r line; do
            log "[$container]   $line"
        done
        docker restart "$container" >> "$LOG_FILE" 2>&1
        log "[$container] Container restarted successfully"
    else
        log "[$container] Healthy, no websocket errors found"
    fi
done

log "--- Monitor check finished ---"
log ""

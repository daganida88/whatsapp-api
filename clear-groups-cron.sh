#!/bin/bash

# WhatsApp API Clear Groups Script

# Configuration
API_URL="http://localhost:3000/api/clear-group-messages"
# This attempts to read the environment variable, or you can hardcode it here
API_KEY="${API_KEY}" 

# SAFETY CHECK: Ensure API Key is present
if [ -z "$API_KEY" ]; then
    echo "Error: API_KEY is not set. Run with: API_KEY='your_key' ./script.sh"
    exit 1
fi

# Group IDs to clear
GROUP_IDS=(
    "120363416054571947@g.us"
    "120363418903974045@g.us"
    "120363399522849498@g.us"
    "120363415762803789@g.us"
    "120363399270393165@g.us"
    "120363372493051923@g.us"
    "120363367624392264@g.us"
    "120363402393467235@g.us"
    "120363353336518266@g.us"
    "120363330337709368@g.us"
    "120363341011004397@g.us"  # <--- This was missing in your version
    "120363404147090059@g.us"
    "120363421776912326@g.us"
    "120363422734920088@g.us"
    "120363422619653082@g.us"
    "120363403506297519@g.us"
    "120363404919734235@g.us"
)

# Log file location (Changed to current directory to avoid permission errors)
LOG_FILE="./whatsapp-clear-groups.log"

# Create log file if it doesn't exist
touch "$LOG_FILE"

# Function to log messages
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_message "Starting group message clearing process..."

# Counter for success/failure
SUCCESS_COUNT=0
FAILURE_COUNT=0

# Loop through each group ID
for GROUP_ID in "${GROUP_IDS[@]}"; do
    log_message "Clearing messages for group: $GROUP_ID"

    # Make the API call
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "{\"chatId\": \"$GROUP_ID\"}")

    # Extract HTTP status code (last line)
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    # Extract response body (everything except last line)
    BODY=$(echo "$RESPONSE" | sed '$d')

    # Check if request was successful
    if [ "$HTTP_CODE" -eq 200 ]; then
        log_message "✅ Successfully cleared messages for $GROUP_ID"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        log_message "❌ Failed to clear messages for $GROUP_ID (HTTP $HTTP_CODE)"
        log_message "Response: $BODY"
        FAILURE_COUNT=$((FAILURE_COUNT + 1))
    fi

    # Small delay to be nice to the server
    sleep 2
done

log_message "Process completed - Success: $SUCCESS_COUNT, Failed: $FAILURE_COUNT"

exit 0
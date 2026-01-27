import os
import json
import sys

# Simple safe fetcher placeholder.
# This script should be configured by creating a `config.json` in the `backend/` folder
# with keys: api_id, api_hash, channel_username, session_path
# It is intentionally NOT storing real secrets in the repository.

base = os.path.dirname(__file__)
config_path = os.path.join(base, 'config.json')
history_file = os.path.join(base, 'schedule_history.json')

if not os.path.exists(config_path):
    print('No config.json found in backend/. Create backend/config.json from config.example.json')
    sys.exit(0)

with open(config_path, 'r', encoding='utf-8') as f:
    cfg = json.load(f)

# If you want to enable the Telegram fetcher, implement the Telethon logic here
# using cfg['api_id'], cfg['api_hash'], etc. For safety this repo ships a placeholder.

# Placeholder: ensure history file exists
if not os.path.exists(history_file):
    with open(history_file, 'w', encoding='utf-8') as f:
        json.dump([], f, ensure_ascii=False, indent=4)
    print('Initialized empty schedule_history.json')
else:
    print('Fetcher ran: schedule_history.json already present')

sys.exit(0)

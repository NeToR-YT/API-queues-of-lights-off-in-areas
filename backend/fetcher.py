import os
import json
import sys
import asyncio
import datetime
import re
from telethon import TelegramClient

base = os.path.dirname(__file__)
config_path = os.path.join(base, 'config.json')
history_file = os.path.join(base, 'schedule_history.json')

if not os.path.exists(config_path):
    print('No config.json found in backend/. Create backend/config.json from config.example.json')
    sys.exit(0)

with open(config_path, 'r', encoding='utf-8') as f:
    cfg = json.load(f)

api_id = cfg.get('api_id')
api_hash = cfg.get('api_hash')
channel_username = cfg.get('channel_username')
session_path = os.path.join(base, cfg.get('session_path', 'session_name'))

if not all([api_id, api_hash, channel_username]):
    print('Missing required config values: api_id, api_hash, channel_username')
    sys.exit(1)

def is_power_outage_schedule(text):
    """Check if message contains power outage schedule"""
    if text is None:
        return False
    keywords = ["графік погодинних вимкнень", "Оновлений графік", "ГОП", "ГПВ", "відсутності електропостачання"]
    return any(keyword in text for keyword in keywords)

def parse_date(text):
    """Parse schedule date from message text"""
    match = re.search(r'(\d{1,2}) (\w+)', text)
    if match:
        day = int(match.group(1))
        month_str = match.group(2)
        months = {
            'січня': 1, 'лютого': 2, 'березня': 3, 'квітня': 4, 'травня': 5, 'червня': 6,
            'липня': 7, 'серпня': 8, 'вересня': 9, 'жовтня': 10, 'листопада': 11, 'грудня': 12
        }
        month = months.get(month_str)
        if month:
            year = datetime.datetime.now().year
            return f"{year}-{month:02d}-{day:02d}"
    return None

def parse_schedule(text):
    """Parse power outage schedule from message text"""
    lines = text.split('\n')
    schedule = {}
    in_schedule = False
    for line in lines:
        line = line.strip()
        if 'Години відсутності електропостачання:' in line:
            in_schedule = True
            continue
        if in_schedule:
            if line and '.' in line and '-' in line:
                parts = line.split(' ', 1)
                if len(parts) == 2:
                    queue = parts[0]
                    periods = [p.strip() for p in parts[1].split(',')]
                    schedule[queue] = periods
            elif not line:
                continue
            else:
                break
    return schedule

async def fetch_messages():
    """Fetch power outage schedules from Telegram channel"""
    client = TelegramClient(session_path, api_id, api_hash)
    
    try:
        await client.start()
        entity = await client.get_entity(channel_username)
        
        # Load existing history
        try:
            with open(history_file, 'r', encoding='utf-8') as f:
                history = json.load(f)
            if not isinstance(history, list):
                history = []
        except (FileNotFoundError, json.JSONDecodeError):
            history = []
        
        # Fetch messages
        async for message in client.iter_messages(entity, limit=100):
            if is_power_outage_schedule(message.text):
                schedule_date = parse_date(message.text)
                if schedule_date:
                    parsed = parse_schedule(message.text)
                    if parsed:  # Only if queues found
                        update_time = (message.date + datetime.timedelta(hours=2)).strftime("%H:%M:%S")
                        # Check if schedule already exists
                        if not any(h['schedule'] == parsed for h in history):
                            history.append({
                                'schedule_date': schedule_date,
                                'schedule_time': update_time,
                                'schedule': parsed
                            })
                            print(f'Added new schedule for {schedule_date} at {update_time}')
        
        # Sort history by date and time (newest first)
        history.sort(key=lambda x: (x['schedule_date'], x['schedule_time']), reverse=True)
        
        # Save history
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=4)
        
        print(f'Successfully updated {history_file}')
        return True
        
    except Exception as e:
        print(f'Error fetching schedules: {str(e)}')
        return False
    finally:
        await client.disconnect()

# Run the async function
if __name__ == '__main__':
    try:
        asyncio.run(fetch_messages())
    except Exception as e:
        print(f'Fatal error: {str(e)}')
        sys.exit(1)

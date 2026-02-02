import os
import json
import sys
import asyncio
import datetime
import re
from telethon import TelegramClient

base = os.path.dirname(__file__)
config_path = os.path.join(base, 'config.json')
today_file = os.path.join(base, 'schedule_today.json')
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

def time_to_minutes(t):
    """Convert HH:MM to minutes since midnight"""
    try:
        h, m = t.split(':')
        return int(h) * 60 + int(m)
    except Exception:
        return None

def period_to_tuple(period):
    """Convert period 'HH:MM-HH:MM' to (start_min, end_min)"""
    parts = period.split('-')
    if len(parts) != 2:
        return None
    s = time_to_minutes(parts[0].strip())
    e = time_to_minutes(parts[1].strip())
    if s is None or e is None:
        return None
    return (s, e)

def tuple_to_period(tup):
    s, e = tup
    return f"{s//60:02d}:{s%60:02d}-{e//60:02d}:{e%60:02d}"

def merge_intervals(periods):
    """Merge list of period strings into non-overlapping sorted periods"""
    tuples = []
    for p in periods:
        t = period_to_tuple(p)
        if t:
            tuples.append(t)
    if not tuples:
        return []
    tuples.sort()
    merged = [tuples[0]]
    for cur in tuples[1:]:
        last = merged[-1]
        if cur[0] <= last[1]:
            merged[-1] = (last[0], max(last[1], cur[1]))
        else:
            merged.append(cur)
    return [tuple_to_period(t) for t in merged]

async def fetch_messages():
    """Fetch power outage schedules from Telegram channel"""
    client = TelegramClient(session_path, api_id, api_hash)
    
    try:
        await client.start()
        entity = await client.get_entity(channel_username)

        try:
            with open(today_file, 'r', encoding='utf-8') as f:
                today_data = json.load(f)
                if not isinstance(today_data, dict):
                    today_data = {}
        except (FileNotFoundError, json.JSONDecodeError):
            today_data = {}

        try:
            with open(history_file, 'r', encoding='utf-8') as f:
                history = json.load(f)
            if not isinstance(history, list):
                history = []
        except (FileNotFoundError, json.JSONDecodeError):
            history = []
        
        today = datetime.datetime.now().strftime("%Y-%m-%d")
        for stored_date in list(today_data.keys()):
            if stored_date != today:
                entry = today_data.get(stored_date, {})
                sched = entry.get('schedule', {}) if isinstance(entry, dict) else {}
                sched_time = entry.get('schedule_time', '') if isinstance(entry, dict) else ''
                if not any(h.get('schedule_date') == stored_date and h.get('schedule') == sched for h in history):
                    history.append({
                        'schedule_date': stored_date,
                        'schedule_time': sched_time,
                        'schedule': sched
                    })
                    print(f'Rolled over {stored_date} to history')
                today_data.pop(stored_date, None)
        

        async for message in client.iter_messages(entity, limit=100):
            if is_power_outage_schedule(message.text):
                schedule_date = parse_date(message.text)
                if schedule_date:
                    parsed = parse_schedule(message.text)
                    if parsed: 
                        update_time = (message.date + datetime.timedelta(hours=2)).strftime("%H:%M:%S")
                        

                        if schedule_date == today:
                            if schedule_date not in today_data:
                                today_data[schedule_date] = {
                                    'schedule_time': update_time,
                                    'schedule': {}
                                }

                            existing = today_data[schedule_date].get('schedule', {})
                            for queue, new_periods in parsed.items():
                                old_periods = existing.get(queue, [])
                                combined = old_periods + new_periods
                                merged = merge_intervals(combined)
                                existing[queue] = merged

                            today_data[schedule_date]['schedule_time'] = update_time
                            today_data[schedule_date]['schedule'] = existing
                            print(f'Merged schedule for {schedule_date} at {update_time}')
                        else:

                            print(f'Ignoring schedule for {schedule_date} (not today)')
        
        with open(today_file, 'w', encoding='utf-8') as f:
            json.dump(today_data, f, ensure_ascii=False, indent=4)
        
        history.sort(key=lambda x: (x['schedule_date'], x['schedule_time']), reverse=True)
        
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=4)
        
        print(f'Successfully updated {today_file} and {history_file}')
        return True
        
    except Exception as e:
        print(f'Error fetching schedules: {str(e)}')
        return False
    finally:
        await client.disconnect()

if __name__ == '__main__':
    try:
        asyncio.run(fetch_messages())
    except Exception as e:
        print(f'Fatal error: {str(e)}')
        sys.exit(1)

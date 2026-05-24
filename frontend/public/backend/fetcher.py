import os
import json
import sys
import asyncio
import datetime
import re
import time
from telethon import TelegramClient

base = os.path.dirname(__file__)
config_path = os.path.join(base, 'config.json')
today_file = os.path.join(base, '../schedule_today.json')
history_file_template = os.path.join(base, '../schedule_history_{}.json')
tomorrow_file = os.path.join(base, '../schedule_tomorrow.json')

if not os.path.exists(config_path):
    print('No config.json found in backend/. Create backend/config.json from config.example.json')
    sys.exit(0)

with open(config_path, 'r', encoding='utf-8') as f:
    cfg = json.load(f)

api_id = cfg.get('api_id')
api_hash = cfg.get('api_hash')
channels = cfg.get('channels', [])
session_path = os.path.join(base, cfg.get('session_path', 'session_name'))

batch_config = cfg.get('batch_parser', {})
batch_size = batch_config.get('batch_size', 2)
batch_delay = batch_config.get('batch_delay', 5)
limit_messages = batch_config.get('limit_messages', 200)
timezone_offset = cfg.get('timezone_offset', 2)

if not all([api_id, api_hash, channels]):
    print('Missing required config values: api_id, api_hash, channels')
    sys.exit(1)

def is_power_outage_schedule(text):
    """Check if message contains power outage schedule"""
    if text is None:
        return False
    t = text.lower()
    keywords = [
        "графік відключення світла",
        "графіки відключення світла",
        "графіки відключень світла",
        "графік погодинних вимкнень",
        "графіки погодинних вимкнень",
        "оновлений графік",
        "оновлені графіки",
        "гоп",
        "гпв",
        "відсутності електропостачання",
        "години відсутності електропостачання",
    ]
    return any(keyword in t for keyword in keywords)

def is_emergency_outage_active(text):
    """Detect whether message states emergency outages (ГАВ/СГАВ) are applied.

    Returns True when a sentence contains positive emergency keywords without
    nearby negation words (e.g. "скасовані").
    """
    if not text:
        return False
    t = text.lower()
    positive = [
        'аварійних відключень',
        'аварійні відключення',
        'га в',
        'гaв',
        'гав',
        'гав)',
        'сгав',
        'сга',
        'застосовані графіки аварійних відключень',
        'застосовані графіки аварійних',
    ]
    negations = ['скасован', 'не застосов', 'не буд', 'не застосовані', 'скасовано', 'не діють']

    sentences = re.split(r'[\n\.\!\?]+', t)
    for s in sentences:
        if any(p in s for p in positive):
            if any(n in s for n in negations):
                return False
            return True
    return False

def parse_date(text):
    """Parse schedule date from message text"""
    if not text:
        return None
    num_match = re.search(r'(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?', text)
    if num_match:
        day = int(num_match.group(1))
        month = int(num_match.group(2))
        year = num_match.group(3)
        tz = datetime.timezone(datetime.timedelta(hours=timezone_offset))
        if year:
            year = int(year)
            if year < 100:
                year += 2000
        else:
            year = datetime.datetime.now(tz).year
        try:
            datetime.date(year, month, day)
            return f"{year:04d}-{month:02d}-{day:02d}"
        except ValueError:
            pass
    match = re.search(r'(\d{1,2})\s+([\w\u0400-\u04FF]+)', text)
    if match:
        day = int(match.group(1))
        month_str = match.group(2).lower().strip().strip('.,')
        months = {
            'січня': 1, 'лютого': 2, 'березня': 3, 'квітня': 4, 'травня': 5, 'червня': 6,
            'липня': 7, 'серпня': 8, 'вересня': 9, 'жовтня': 10, 'листопада': 11, 'грудня': 12
        }
        month = months.get(month_str)
        if month:
            tz = datetime.timezone(datetime.timedelta(hours=timezone_offset))
            year = datetime.datetime.now(tz).year
            return f"{year}-{month:02d}-{day:02d}"
    return None

def normalize_dashes(text):
    """Normalize all dash-like characters to regular dash"""
    text = text.replace('\u2013', '-') 
    text = text.replace('\u2014', '-') 
    text = text.replace('\u2010', '-') 
    text = text.replace('\u00A0', ' ') 
    return text

def parse_schedule(text):
    """Parse power outage schedule from message text with support for multiple formats"""
    text = normalize_dashes(text)
    lines = text.split('\n')
    schedule = {}
    current_queue = None

    def parse_period(period):
        time_match = re.search(r'(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})', period)
        if time_match:
            start_h, start_m, end_h, end_m = map(int, time_match.groups())
            return f"{start_h:02d}:{start_m:02d}-{end_h:02d}:{end_m:02d}"
        hour_match = re.search(r'(\d{1,2})\s*-\s*(\d{1,2})', period)
        if hour_match:
            start_h, end_h = map(int, hour_match.groups())
            return f"{start_h:02d}:00-{end_h:02d}:00"
        return None

    def parse_hour_periods(times_str):
        periods = []
        for part in re.split(r'[;,]', times_str):
            part = part.strip()
            if not part:
                continue
            parsed = parse_period(part)
            if parsed:
                periods.append(parsed)
        return periods
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        line = re.sub(r'[🔹❗✅➡️💡⚠️🗓📍⚡🏆⌛️]+', '', line).strip()

        queue_header = re.search(r'(?:черга|група)\s*\[?\s*([0-6](?:\.[12])?)\s*\]?', line, re.IGNORECASE)
        if queue_header:
            current_queue = queue_header.group(1).strip()

        graph_match = re.search(r'графік\s*:?\s*(.*)$', line, re.IGNORECASE)
        if graph_match and current_queue:
            periods = parse_hour_periods(graph_match.group(1))
            if periods:
                schedule[current_queue] = periods
            continue
        
        match = re.match(r'^([0-6](?:\.[12])?)\s*[:–\-]?\s*(\d{1,2}(?::\d{2})?.*)$', line)
        if match:
            queue = match.group(1).strip()
            times_str = match.group(2).strip()
            
            periods = []
            for separator in [',', ';']:
                if separator in times_str:
                    period_parts = times_str.split(separator)
                    periods = [p.strip() for p in period_parts if p.strip()]
                    break
            
            if not periods:
                periods = [times_str]
            
            valid_periods = []
            for period in periods:
                parsed = parse_period(period)
                if parsed:
                    valid_periods.append(parsed)
            
            if valid_periods and queue:
                schedule[queue] = valid_periods
    
    return schedule if schedule else {}

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
    if e <= s:
        e += 24 * 60
    return (s, e)

def tuple_to_period(tup):
    s, e = tup
    e_mod = e % (24 * 60)
    return f"{s//60:02d}:{s%60:02d}-{e_mod//60:02d}:{e_mod%60:02d}"

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

def rotate_schedules(today_data, tomorrow_data, all_history, channels):
    """Rotate schedules at midnight: tomorrow -> today, today -> history"""
    tz = datetime.timezone(datetime.timedelta(hours=timezone_offset))
    today = str(datetime.datetime.now(tz).date())
    
    for channel in channels:
        channel_id = channel.get('id')
        
        today_idx = next((i for i, item in enumerate(today_data) if item.get('channel_id') == channel_id), -1)
        if today_idx != -1:
            today_item = today_data[today_idx]
            schedule_date = today_item.get('schedule_date', today)
            
            if not any(h.get('schedule_date') == schedule_date and h.get('channel_id') == channel_id for h in all_history.get(channel_id, [])):
                history_entry = {
                    'channel_id': channel_id,
                    'schedule_date': schedule_date,
                    'schedule_time': today_item.get('schedule_time', ''),
                    'schedule': today_item.get('schedule', {}),
                    'emergency_outages': today_item.get('emergency_outages', False)
                }
                if channel_id not in all_history:
                    all_history[channel_id] = []
                all_history[channel_id].append(history_entry)
    
    for item in tomorrow_data:
        item['schedule_date'] = today  
    
    return tomorrow_data, [], all_history

async def fetch_messages_for_channel(client, channel, today, tomorrow):
    """Fetch messages for a single channel"""
    channel_id = channel.get('id')
    channel_name = channel.get('name')
    channel_username = channel.get('username')
    
    best_result = None
    tomorrow_result = None
    fallback_result = None 
    all_found_dates = []
    messages_checked = 0
    schedule_messages_found = 0
    
    try:
        entity = await client.get_entity(channel_username)
        print(f"Processing channel {channel_id} ({channel_name}): {channel_username}")
        
        async for message in client.iter_messages(entity, limit=limit_messages):
            messages_checked += 1
            
            if is_power_outage_schedule(message.text):
                schedule_messages_found += 1
                schedule_date = parse_date(message.text)
                
                if schedule_date:
                    parsed = parse_schedule(message.text)

                    tz = datetime.timezone(datetime.timedelta(hours=timezone_offset))
                    update_time = (message.date + datetime.timedelta(hours=timezone_offset)).strftime("%H:%M:%S")
                    emergency_flag = is_emergency_outage_active(message.text)
                    
                    all_found_dates.append(schedule_date)
                    
                    if schedule_date == today and best_result is None:
                        best_result = {
                            'channel_id': channel_id,
                            'schedule_date': schedule_date,
                            'schedule_time': update_time,
                            'schedule': parsed,
                            'emergency_outages': emergency_flag
                        }
                    elif schedule_date == tomorrow and tomorrow_result is None:
                        tomorrow_result = {
                            'channel_id': channel_id,
                            'schedule_date': schedule_date,
                            'schedule_time': update_time,
                            'schedule': parsed,
                            'emergency_outages': emergency_flag
                        }
                        if best_result and tomorrow_result:
                            break
                    elif fallback_result is None:
                        fallback_result = {
                            'channel_id': channel_id,
                            'schedule_date': schedule_date,
                            'schedule_time': update_time,
                            'schedule': parsed,
                            'emergency_outages': emergency_flag
                        }
        
        result_to_return = None
        
        if best_result or tomorrow_result or fallback_result:
            result_to_return = {
                'today': best_result,
                'tomorrow': tomorrow_result,
                'fallback': fallback_result
            }
            
            found_dates = []
            if best_result:
                found_dates.append(f"today ({best_result['schedule_date']})")
            if tomorrow_result:
                found_dates.append(f"tomorrow ({tomorrow_result['schedule_date']})")
            if not found_dates and fallback_result:
                found_dates.append(f"fallback ({fallback_result['schedule_date']})")
            
            if found_dates:
                print(f"[OK] Channel {channel_id}: Found {', '.join(found_dates)}")
            return result_to_return
        else:
            dates_info = f", found dates: {set(all_found_dates)}" if all_found_dates else ""
            print(f"[ERR] Channel {channel_id}: Checked {messages_checked} messages, found {schedule_messages_found} schedule messages{dates_info}")
            return None
        
    except Exception as e:
        print(f'[ERR] Error fetching from channel {channel_id}: {str(e)}')
        return None

async def fetch_all_channels():
    """Fetch schedules from all channels with batch processing and delays"""
    client = TelegramClient(session_path, api_id, api_hash)
    
    try:
        await client.start()
        
        tz = datetime.timezone(datetime.timedelta(hours=timezone_offset))
        today = str(datetime.datetime.now(tz).date())
        tomorrow = str(datetime.datetime.now(tz).date() + datetime.timedelta(days=1))
        
        today_data = []
        tomorrow_data = []
        all_history = {}
        
        try:
            with open(today_file, 'r', encoding='utf-8') as f:
                today_data = json.load(f)
                if not isinstance(today_data, list):
                    today_data = []
        except (FileNotFoundError, json.JSONDecodeError):
            today_data = []
        
        try:
            with open(tomorrow_file, 'r', encoding='utf-8') as f:
                tomorrow_data = json.load(f)
                if not isinstance(tomorrow_data, list):
                    tomorrow_data = []
        except (FileNotFoundError, json.JSONDecodeError):
            tomorrow_data = []
        
        for channel in channels:
            channel_id = channel.get('id')
            history_file_path = history_file_template.format(channel_id)
            try:
                if os.path.exists(history_file_path):
                    with open(history_file_path, 'r', encoding='utf-8') as f:
                        all_history[channel_id] = json.load(f)
                        if not isinstance(all_history[channel_id], list):
                            all_history[channel_id] = []
                else:
                    all_history[channel_id] = []
            except (json.JSONDecodeError, IOError):
                all_history[channel_id] = []
        
        rotated = False
        if today_data and today_data[0].get('schedule_date') != today:
            print("[ROTATE] Rotating schedules (crossed midnight)...")
            today_data, tomorrow_data, all_history = rotate_schedules(today_data, tomorrow_data, all_history, channels)
            rotated = True
        
        today_updated = 0
        tomorrow_updated = 0
        
        for batch_idx in range(0, len(channels), batch_size):
            batch = channels[batch_idx:batch_idx + batch_size]
            print(f"\nProcessing batch {batch_idx // batch_size + 1}/{(len(channels) + batch_size - 1) // batch_size}")
            print(f"Parsing up to {limit_messages} messages per channel")
            
            for channel in batch:
                channel_id = channel.get('id')
                
                result = await fetch_messages_for_channel(client, channel, today, tomorrow)
                
                if result:
                    today_result = result.get('today')
                    tomorrow_result = result.get('tomorrow')
                    fallback_result = result.get('fallback')
                    # Update today data
                    if today_result:
                        schedule_date = today_result['schedule_date']
                        today_idx = next((i for i, item in enumerate(today_data) if item.get('channel_id') == channel_id), -1)
                        if today_idx != -1:
                            existing = today_data[today_idx].get('schedule', {})
                            for queue, new_periods in today_result['schedule'].items():
                                old_periods = existing.get(queue, [])
                                combined = old_periods + new_periods
                                merged = merge_intervals(combined)
                                existing[queue] = merged
                            today_data[today_idx]['schedule_time'] = today_result['schedule_time']
                            today_data[today_idx]['schedule_date'] = schedule_date
                            today_data[today_idx]['emergency_outages'] = today_result['emergency_outages'] or today_data[today_idx].get('emergency_outages', False)
                        else:
                            today_data.append({
                                'channel_id': channel_id,
                                'schedule_date': schedule_date,
                                'schedule_time': today_result['schedule_time'],
                                'schedule': today_result['schedule'],
                                'emergency_outages': today_result['emergency_outages']
                            })
                        today_updated += 1
                    
                    # Update tomorrow data
                    if tomorrow_result:
                        schedule_date = tomorrow_result['schedule_date']
                        tomorrow_idx = next((i for i, item in enumerate(tomorrow_data) if item.get('channel_id') == channel_id), -1)
                        if tomorrow_idx != -1:
                            existing = tomorrow_data[tomorrow_idx].get('schedule', {})
                            for queue, new_periods in tomorrow_result['schedule'].items():
                                old_periods = existing.get(queue, [])
                                combined = old_periods + new_periods
                                merged = merge_intervals(combined)
                                existing[queue] = merged
                            tomorrow_data[tomorrow_idx]['schedule_time'] = tomorrow_result['schedule_time']
                            tomorrow_data[tomorrow_idx]['schedule_date'] = schedule_date
                            tomorrow_data[tomorrow_idx]['emergency_outages'] = tomorrow_result['emergency_outages'] or tomorrow_data[tomorrow_idx].get('emergency_outages', False)
                        else:
                            tomorrow_data.append({
                                'channel_id': channel_id,
                                'schedule_date': schedule_date,
                                'schedule_time': tomorrow_result['schedule_time'],
                                'schedule': tomorrow_result['schedule'],
                                'emergency_outages': tomorrow_result['emergency_outages']
                            })
                        tomorrow_updated += 1
                    
                    if fallback_result and not today_result:
                        fallback_result['schedule_date'] = today
                        today_idx = next((i for i, item in enumerate(today_data) if item.get('channel_id') == channel_id), -1)
                        if today_idx == -1:
                            today_data.append({
                                'channel_id': channel_id,
                                'schedule_date': today,
                                'schedule_time': fallback_result['schedule_time'],
                                'schedule': fallback_result['schedule'],
                                'emergency_outages': fallback_result['emergency_outages']
                            })
                            today_updated += 1
            
            if batch_idx + batch_size < len(channels):
                print(f"Waiting {batch_delay} seconds before next batch...")
                await asyncio.sleep(batch_delay)
        
        # Save today data
        with open(today_file, 'w', encoding='utf-8') as f:
            json.dump(today_data, f, ensure_ascii=False, indent=4)
        
        # Save tomorrow data
        with open(tomorrow_file, 'w', encoding='utf-8') as f:
            json.dump(tomorrow_data, f, ensure_ascii=False, indent=4)
        
        # Save individual history files
        for channel in channels:
            channel_id = channel.get('id')
            history = all_history.get(channel_id, [])
            history.sort(key=lambda x: x['schedule_date'], reverse=True)
            
            history_file_path = history_file_template.format(channel_id)
            with open(history_file_path, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=4)
        
        print(f'\n{"="*60}')
        print(f'Parsing complete!')
        if rotated:
            print(f'[OK] Schedules rotated to new day')
        print(f'Updated today schedules: {today_updated}/{len(channels)} channels')
        print(f'Updated tomorrow schedules: {tomorrow_updated}/{len(channels)} channels')
        print(f'Saved to: {today_file}, {tomorrow_file} and history files')
        print(f'{"="*60}')
        return True
        
    except Exception as e:
        print(f'Error: {str(e)}')
        return False
    finally:
        await client.disconnect()

if __name__ == '__main__':
    try:
        asyncio.run(fetch_all_channels())
    except Exception as e:
        print(f'Fatal error: {str(e)}')
        sys.exit(1)
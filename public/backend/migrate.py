import json
import os
import glob
from db import MongoDB

from datetime import datetime, timedelta

def migrate():
    db = MongoDB()
    base = os.path.dirname(__file__)
    public_dir = os.path.join(base, '..')
    
    print("--- Starting Clean Multi-Collection Migration ---")

    # 0. Drop old collection if exists
    db.db['schedules'].drop()
    print("Dropped old 'schedules' collection.")

    # 1. Migrate cities
    cities_file = os.path.join(base, 'cities.json')
    if os.path.exists(cities_file):
        with open(cities_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            db.save_cities(data.get('cities', []))
        print("Cities migrated.")

    # 2. Setup dates
    today_date = datetime.now().strftime("%Y-%m-%d")
    tomorrow_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    # 3. Migrate Today
    today_path = os.path.join(public_dir, 'schedule_today.json')
    if os.path.exists(today_path):
        with open(today_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, list):
                db.save_schedules_batch('schedules_today', data)
                # Also save to history
                db.save_schedules_batch('schedules_history', data)
        print("Today's schedules migrated.")

    # 4. Migrate Tomorrow
    tomorrow_path = os.path.join(public_dir, 'schedule_tomorrow.json')
    if os.path.exists(tomorrow_path):
        with open(tomorrow_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, list):
                db.save_schedules_batch('schedules_tomorrow', data)
                # Also save to history
                db.save_schedules_batch('schedules_history', data)
        print("Tomorrow's schedules migrated.")

    # 5. Migrate History Files
    history_files = glob.glob(os.path.join(public_dir, 'schedule_history_*.json'))
    for file_path in history_files:
        if os.path.getsize(file_path) <= 2: continue
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, list):
                db.save_schedules_batch('schedules_history', data)
        print(f"Migrated history from {os.path.basename(file_path)}")

    # 6. Create sorted views
    db.setup_views()

    print(f"\n--- Migration Complete ---")
    print(f"Today: {db.schedules_today.count_documents({})}")
    print(f"Tomorrow: {db.schedules_tomorrow.count_documents({})}")
    print(f"History (all): {db.schedules_history.count_documents({})}")

if __name__ == '__main__':
    migrate()

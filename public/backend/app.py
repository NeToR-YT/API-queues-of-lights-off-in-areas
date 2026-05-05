from flask import Flask, jsonify, render_template, request
import json
import os
import subprocess
import sys
import time
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timedelta
from db import MongoDB

app = Flask(__name__, template_folder='templates', static_folder='static')
db_manager = MongoDB()

last_update = {
    'timestamp': None,
    'status': 'pending',  
    'message': 'Чекання першого оновлення...'
}
update_in_progress = False


def update_data_task():
    """Запуск парсера для оновлення даних"""
    global last_update, update_in_progress
    
    if update_in_progress:
        print("Оновлення вже в процесі...")
        return
    
    update_in_progress = True
    try:
        base = os.path.dirname(__file__)
        fetcher = os.path.join(base, 'fetcher.py')
        
        print(f"[{datetime.now()}] Запуск парсера...")
        result = subprocess.run([sys.executable, fetcher], capture_output=True, text=True, cwd=base, timeout=120)
        
        if result.returncode == 0:
            last_update = {
                'timestamp': datetime.now().isoformat(),
                'status': 'success',
                'message': 'Дані оновлено успішно!'
            }
            print("✓ Дані оновлено успішно!")
        else:
            last_update = {
                'timestamp': datetime.now().isoformat(),
                'status': 'error',
                'message': f'Помилка: {result.stderr[:200]}'
            }
            print(f"✗ Помилка оновлення: {result.stderr}")
    except subprocess.TimeoutExpired:
        last_update = {
            'timestamp': datetime.now().isoformat(),
            'status': 'error',
            'message': 'ЧасTimeout - парсер брав надто довго'
        }
        print("✗ Timeout: парсер брав надто довго")
    except Exception as e:
        last_update = {
            'timestamp': datetime.now().isoformat(),
            'status': 'error',
            'message': f'Помилка: {str(e)[:200]}'
        }
        print(f"✗ Помилка: {str(e)}")
    finally:
        update_in_progress = False



scheduler = BackgroundScheduler()
scheduler.add_job(func=update_data_task, trigger="interval", minutes=15)
scheduler.start()

# Запуск парсера один раз при старті (необов'язково, але корисно для першого заповнення даних)
print("API стартує... Запуск першого оновлення даних...")
update_data_task()


@app.route('/', methods=['GET'])
def index():
    return render_template('index.html')

@app.route('/api/cities', methods=['GET'])
def get_cities():
    """
    GET /api/cities
    Повертає список всіх міст
    """
    cities = db_manager.get_cities()
    return jsonify({"cities": cities})

@app.route('/api/status', methods=['GET'])
def get_status():
    """
    GET /api/status
    Повертає статус останнього оновлення даних парсером
    """
    return jsonify({
        'last_update': last_update,
        'parsing_in_progress': update_in_progress,
        'auto_update_interval_minutes': 15
    })

@app.route('/api/update', methods=['POST'])
def trigger_update():
    """
    POST /api/update
    Запуск ручного оновлення даних парсером
    """
    if update_in_progress:
        return jsonify({
            'status': 'in_progress',
            'message': 'Оновлення вже в процесі...'
        }), 202
    
    # Запуск в окремому потоці щоб не блокувати API
    try:
        update_data_task()
        return jsonify({
            'status': 'started',
            'message': 'Оновлення запущено',
            'last_update': last_update
        }), 202
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Помилка запуску: {str(e)}'
        }), 500

@app.route('/api/schedules', methods=['GET'])
def get_schedules():
    """
    GET /api/schedules
    Параметри:
      - channel_id: ID каналу/міста (обовязковий)
      - date: дата графіка (обовязковий) - формат: YYYY-MM-DD
      - queue: номер черги (опціональний)
    """
    channel_id = request.args.get('channel_id', type=int)
    date = request.args.get('date')
    queue = request.args.get('queue')
    
    if not channel_id or not date:
        return jsonify({"error": "channel_id та date параметри обов'язкові"}), 400
    
    doc = db_manager.get_schedule(channel_id, date)
    
    if not doc:
        return jsonify({"error": f"Розклад на {date} не знайдено"}), 404
    
    schedule_data = doc.get('schedule', {})
    schedule_time = doc.get('schedule_time', '')
    emergency_outages = doc.get('emergency_outages', False)
    
    if queue:
        if queue in schedule_data:
            filtered_schedule = {queue: schedule_data[queue]}
        else:
            return jsonify({"error": f"Черга {queue} не знайдена"}), 404
    else:
        filtered_schedule = schedule_data
    
    city_doc = db_manager.get_city_by_id(channel_id)
    city_name = city_doc.get('name') if city_doc else "Невідоме місто"
    
    response = {
        "channel_id": channel_id,
        "city_name": city_name,
        "date": date,
        "time": schedule_time,
        "schedule": filtered_schedule,
        "emergency_outages": emergency_outages
    }
    
    return jsonify(response)


@app.route('/api/schedules/today', methods=['GET'])
def get_schedules_today():
    """
    GET /api/schedules/today
    Параметри:
      - channel_id: ID каналу/міста (обовязковий)
      - queue: номер черги (опціональний)
    """
    channel_id = request.args.get('channel_id', type=int)
    queue = request.args.get('queue')
    
    if not channel_id:
        return jsonify({"error": "channel_id параметр обов'язковий"}), 400
    
    # Визначаємо сьогоднішню дату (з урахуванням зміщення часового поясу, якщо потрібно)
    # Для простоти використовуємо серверний час, або можна брати з конфігу
    today_date = datetime.now().strftime("%Y-%m-%d")
    
    doc = db_manager.get_schedule(channel_id, today_date)
    
    if not doc:
        return jsonify({"error": "Розклад на сьогодні не знайдено"}), 404
    
    schedule_data = doc.get('schedule', {})
    schedule_time = doc.get('schedule_time', '')
    schedule_date = doc.get('schedule_date', today_date)
    emergency_outages = doc.get('emergency_outages', False)
    
    if queue:
        if queue in schedule_data:
            filtered_schedule = {queue: schedule_data[queue]}
        else:
            return jsonify({"error": f"Черга {queue} не знайдена"}), 404
    else:
        filtered_schedule = schedule_data

    city_doc = db_manager.get_city_by_id(channel_id)
    city_name = city_doc.get('name') if city_doc else "Невідоме місто"
    
    response = {
        "channel_id": channel_id,
        "city_name": city_name,
        "date": schedule_date,
        "time": schedule_time,
        "schedule": filtered_schedule,
        "emergency_outages": emergency_outages
    }
    
    return jsonify(response)



@app.route('/api/schedules/tomorrow', methods=['GET'])
def get_schedules_tomorrow():
    """
    GET /api/schedules/tomorrow
    Параметри:
      - channel_id: ID каналу/міста (обовязковий)
      - queue: номер черги (опціональний)
    """
    channel_id = request.args.get('channel_id', type=int)
    queue = request.args.get('queue')
    
    if not channel_id:
        return jsonify({"error": "channel_id параметр обов'язковий"}), 400
    
    tomorrow_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    
    doc = db_manager.get_schedule(channel_id, tomorrow_date)
    
    if not doc:
        return jsonify({"error": "Розклад на завтра не знайдено"}), 404
    
    schedule_data = doc.get('schedule', {})
    schedule_time = doc.get('schedule_time', '')
    schedule_date = doc.get('schedule_date', tomorrow_date)
    emergency_outages = doc.get('emergency_outages', False)
    
    if queue:
        if queue in schedule_data:
            filtered_schedule = {queue: schedule_data[queue]}
        else:
            return jsonify({"error": f"Черга {queue} не знайдена"}), 404
    else:
        filtered_schedule = schedule_data
    
    city_doc = db_manager.get_city_by_id(channel_id)
    city_name = city_doc.get('name') if city_doc else "Невідоме місто"
    
    response = {
        "channel_id": channel_id,
        "city_name": city_name,
        "date": schedule_date,
        "time": schedule_time,
        "schedule": filtered_schedule,
        "emergency_outages": emergency_outages
    }
    
    return jsonify(response)


import atexit

atexit.register(lambda: scheduler.shutdown())


if __name__ == '__main__':
    app.run(debug=True)

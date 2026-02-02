from flask import Flask, jsonify, render_template, request
import json
import os
import subprocess
import sys
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime

app = Flask(__name__, template_folder='templates', static_folder='static')


def update_data_task():
    try:
        base = os.path.dirname(__file__)
        fetcher = os.path.join(base, 'fetcher.py')
        result = subprocess.run([sys.executable, fetcher], capture_output=True, text=True, cwd=base)
        if result.returncode == 0:
            print("Дані оновлено успішно!")
        else:
            print(f"Помилка оновлення: {result.stderr}")
    except Exception as e:
        print(f"Помилка: {str(e)}")


scheduler = BackgroundScheduler()
scheduler.add_job(func=update_data_task, trigger="interval", minutes=15)
scheduler.start()


@app.route('/', methods=['GET'])
def index():
    return render_template('index.html')

@app.route('/api/cities', methods=['GET'])
def get_cities():
    """
    GET /api/cities
    Повертає список всіх міст
    """
    base = os.path.dirname(__file__)
    file = os.path.join(base, 'cities.json')
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    else:
        return jsonify({"cities": []}) 

@app.route('/api/schedules', methods=['GET'])
def get_schedules():
    """
    GET /api/schedules
    Параметри:
      - city_id: ID міста (обовязковий)
      - date: дата графіка (обовязковий) - формат: YYYY-MM-DD
      - queue: номер черги (опціональний)
    """
    city_id = request.args.get('city_id', type=int)
    date = request.args.get('date')
    queue = request.args.get('queue')
    
    if not city_id or not date:
        return jsonify({"error": "city_id та date параметри обов'язкові"}), 400
    
    base = os.path.dirname(__file__)
    

    history_file = os.path.join(base, 'schedule_history.json')
    schedule_data = None
    schedule_time = None
    
    if os.path.exists(history_file):
        try:
            with open(history_file, 'r', encoding='utf-8') as f:
                history = json.load(f)
                for item in history:
                    if item.get('schedule_date') == date:
                        schedule_data = item.get('schedule', {})
                        schedule_time = item.get('schedule_time', '')
                        break
        except json.JSONDecodeError:
            pass
    
    if not schedule_data:
        return jsonify({"error": f"Розклад на {date} не знайдено"}), 404
    

    if queue:
        if queue in schedule_data:
            filtered_schedule = {queue: schedule_data[queue]}
        else:
            return jsonify({"error": f"Черга {queue} не знайдена"}), 404
    else:
        filtered_schedule = schedule_data
    

    cities_file = os.path.join(base, 'cities.json')
    city_name = None
    if os.path.exists(cities_file):
        try:
            with open(cities_file, 'r', encoding='utf-8') as f:
                cities_data = json.load(f)
                for city in cities_data.get('cities', []):
                    if city['id'] == city_id:
                        city_name = city['name']
                        break
        except json.JSONDecodeError:
            pass
    
    response = {
        "city_id": city_id,
        "city_name": city_name or "Невідоме місто",
        "date": date,
        "time": schedule_time,
        "schedule": filtered_schedule
    }
    
    return jsonify(response)


@app.route('/api/schedules/today', methods=['GET'])
def get_schedules_today():
    """
    GET /api/schedules/today
    Параметри:
      - city_id: ID міста (обовязковий)
      - queue: номер черги (опціональний)
    """
    city_id = request.args.get('city_id', type=int)
    queue = request.args.get('queue')
    
    if not city_id:
        return jsonify({"error": "city_id параметр обов'язковий"}), 400
    
    base = os.path.dirname(__file__)
    today_file = os.path.join(base, 'schedule_today.json')
    
    schedule_data = None
    schedule_time = None
    schedule_date = None
    
    if os.path.exists(today_file):
        try:
            with open(today_file, 'r', encoding='utf-8') as f:
                today_data = json.load(f)
                for date_key, date_content in today_data.items():
                    schedule_date = date_key
                    schedule_data = date_content.get('schedule', {})
                    schedule_time = date_content.get('schedule_time', '')
                    break
        except json.JSONDecodeError:
            pass
    
    if not schedule_data:
        return jsonify({"error": "Розклад на сьогодні не знайдено"}), 404
    
    if queue:
        if queue in schedule_data:
            filtered_schedule = {queue: schedule_data[queue]}
        else:
            return jsonify({"error": f"Черга {queue} не знайдена"}), 404
    else:
        filtered_schedule = schedule_data
    

    cities_file = os.path.join(base, 'cities.json')
    city_name = None
    if os.path.exists(cities_file):
        try:
            with open(cities_file, 'r', encoding='utf-8') as f:
                cities_data = json.load(f)
                for city in cities_data.get('cities', []):
                    if city['id'] == city_id:
                        city_name = city['name']
                        break
        except json.JSONDecodeError:
            pass
    
    response = {
        "city_id": city_id,
        "city_name": city_name or "Невідоме місто",
        "date": schedule_date,
        "time": schedule_time,
        "schedule": filtered_schedule
    }
    
    return jsonify(response)



import atexit

atexit.register(lambda: scheduler.shutdown())


if __name__ == '__main__':
    app.run(debug=True)

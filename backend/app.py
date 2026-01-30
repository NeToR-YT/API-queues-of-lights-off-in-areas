from flask import Flask, jsonify, render_template
import json
import os
import subprocess
import sys
from apscheduler.schedulers.background import BackgroundScheduler

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

@app.route('/api/cities' , methods=['GET'])
def get_cities():
    base = os.path.dirname(__file__)
    file = os.path.join(base, 'cities.json')
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    else:
        return jsonify([]) 

@app.route('/schedules_today', methods=['GET'])
def get_schedules():
    base = os.path.dirname(__file__)
    file = os.path.join(base, 'schedule_today.json')
    if os.path.exists(file):
        try:
            with open(file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    data = json.loads(content)
                else:
                    data = []
        except json.JSONDecodeError:
            data = []
        return jsonify(data)
    else:
        return jsonify([])


import atexit

atexit.register(lambda: scheduler.shutdown())


if __name__ == '__main__':
    app.run(debug=True)

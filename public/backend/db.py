import json
import os
from pymongo import MongoClient, UpdateOne
from datetime import datetime

class MongoDB:
    def __init__(self, config_path=None):
        if config_path is None:
            base = os.path.dirname(__file__)
            config_path = os.path.join(base, 'config.json')
        
        with open(config_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
            
        self.uri = cfg.get('mongodb_uri', 'mongodb://localhost:27017/')
        self.db_name = cfg.get('mongodb_db', 'lightua')
        self.client = MongoClient(self.uri)
        self.db = self.client[self.db_name]
        
        # Collections
        self.cities = self.db['cities']
        self.schedules_today = self.db['schedules_today']
        self.schedules_tomorrow = self.db['schedules_tomorrow']
        self.schedules_history = self.db['schedules_history']
        
        # Ensure indexes
        self.cities.create_index('id', unique=True)
        self.schedules_today.create_index('channel_id', unique=True)
        self.schedules_tomorrow.create_index('channel_id', unique=True)
        self.schedules_history.create_index([('channel_id', 1), ('schedule_date', 1)], unique=True)

    def setup_views(self):
        """Створює відсортовані представлення (Views) для Compass"""
        try:
            # Видаляємо старі, якщо є
            self.db.drop_collection('today_sorted')
            self.db.drop_collection('tomorrow_sorted')
            
            # Створюємо нові відсортовані представлення
            self.db.command({
                'create': 'today_sorted',
                'viewOn': 'schedules_today',
                'pipeline': [{'$sort': {'channel_id': 1}}]
            })
            self.db.command({
                'create': 'tomorrow_sorted',
                'viewOn': 'schedules_tomorrow',
                'pipeline': [{'$sort': {'channel_id': 1}}]
            })
            print("Sorted views (today_sorted, tomorrow_sorted) created successfully.")
        except Exception as e:
            print(f"Error creating views: {e}")

    def get_cities(self):
        return list(self.cities.find({}, {'_id': 0}).sort('id', 1))

    def save_cities(self, cities_list):
        for city in cities_list:
            self.cities.update_one({'id': city['id']}, {'$set': city}, upsert=True)

    def get_schedule(self, channel_id, date):
        # Check today, then tomorrow, then history
        today_date = datetime.now().strftime("%Y-%m-%d")
        tomorrow_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        if date == today_date:
            return self.schedules_today.find_one({'channel_id': channel_id}, {'_id': 0})
        elif date == tomorrow_date:
            return self.schedules_tomorrow.find_one({'channel_id': channel_id}, {'_id': 0})
        else:
            return self.schedules_history.find_one({'channel_id': channel_id, 'schedule_date': date}, {'_id': 0})

    def save_schedule_to_collection(self, collection_name, item):
        collection = self.db[collection_name]
        query = {'channel_id': item['channel_id']}
        if collection_name == 'schedules_history':
            query['schedule_date'] = item['schedule_date']
            
        collection.update_one(
            query,
            {
                '$set': {
                    'schedule_date': item['schedule_date'],
                    'schedule': item['schedule'],
                    'schedule_time': item['schedule_time'],
                    'emergency_outages': item.get('emergency_outages', False),
                    'last_updated': datetime.now()
                }
            },
            upsert=True
        )

    def save_schedules_batch(self, collection_name, schedules_list):
        collection = self.db[collection_name]
        operations = []
        for item in schedules_list:
            query = {'channel_id': item['channel_id']}
            if collection_name == 'schedules_history':
                query['schedule_date'] = item['schedule_date']
                
            operations.append(
                UpdateOne(
                    query,
                    {
                        '$set': {
                            'schedule_date': item['schedule_date'],
                            'schedule': item['schedule'],
                            'schedule_time': item['schedule_time'],
                            'emergency_outages': item.get('emergency_outages', False),
                            'last_updated': datetime.now()
                        }
                    },
                    upsert=True
                )
            )
        if operations:
            collection.bulk_write(operations)

    def get_city_by_id(self, channel_id):
        return self.cities.find_one({'id': channel_id}, {'_id': 0})

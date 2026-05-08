export interface Channel {
  id: number;
  name: string;
  username: string;
}

export interface BatchConfig {
  batch_size: number;
  batch_delay: number;
  limit_messages: number;
}

export interface Config {
  api_id: number;
  api_hash: string;
  session_string: string;
  channels: Channel[];
  batch_parser: BatchConfig;
  timezone_offset: number;
  update_interval_minutes?: number;
  mongodb_uri?: string;
  mongodb_db?: string;
  mongodb_bin?: string;
  mongodb_data_path?: string;
  mongodb_port?: number;
}

export interface ScheduleEntry {
  channel_id: number;
  schedule_date: string;
  schedule_time: string;
  schedule: Record<string, string[]>;
  emergency_outages: boolean;
}

export interface City {
  id: number;
  name: string;
}

export type UpdateStatus = {
  timestamp: string | null;
  status: "pending" | "running" | "success" | "error";
  message: string;
};

export interface ChannelFetchResult {
  today: ScheduleEntry | null;
  tomorrow: ScheduleEntry | null;
  fallback: ScheduleEntry | null;
}

export interface DailyStat {
  date: string;
  off_minutes: number;
  blocks_count: number;
  hourly_mask: number[];
  emergency: boolean;
  intervals: Array<[number, number]>;
}

export interface SummaryStat {
  period: { from: string; to: string; days_total: number; days_with_data: number };
  total_off_hours: number;
  avg_off_hours_per_day: number;
  min_off_hours_per_day: number;
  max_off_hours_per_day: number;
  stddev_off_hours: number;
  reliability_percent: number;
  avg_block_minutes: number;
  avg_blocks_per_day: number;
  longest_blackout_streak_minutes: number;
  longest_power_streak_minutes: number;
  min_blackout_duration_minutes: number;
  min_power_duration_minutes: number;
  top_worst_days: Array<{ date: string; off_hours: number }>;
  top_best_days: Array<{ date: string; off_hours: number }>;
  emergency_days_count: number;
  emergency_rate_percent: number;
}

export interface HeatmapStat {
  hours: number[];
  worst_hour: number;
  best_hour: number;
  days_count: number;
}

export interface WeekdayStat {
  weekdays: Array<{ weekday: number; name: string; avg_off_hours: number; days_count: number }>;
  worst_weekday: number;
  best_weekday: number;
}

export interface BucketsStat {
  morning: number;
  day: number;
  evening: number;
  night: number;
  total_days: number;
}

export interface TimeseriesPoint {
  date: string;
  off_hours: number;
  blocks_count: number;
  emergency: boolean;
}

export interface TypicalWindowStat {
  avg_first_off: string | null;
  avg_last_on: string | null;
  avg_dominant_start: string | null;
  avg_dominant_end: string | null;
  days_with_outage: number;
}

export interface QueueBreakdownItem {
  queue: string;
  avg_off_hours: number;
  total_off_hours: number;
  reliability_percent: number;
  days_with_data: number;
}

export interface CoverageStat {
  expected_days: number;
  days_with_data: number;
  coverage_percent: number;
  missing_dates: string[];
}

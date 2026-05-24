import React, { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';

const StatsPage = ({ theme }) => {
  const [mode, setMode] = useState('range');
  const [status, setStatus] = useState({ text: 'готово', kind: '' });
  const [cities, setCities] = useState([]);
  const [queues, setQueues] = useState([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedQueue, setSelectedQueue] = useState('union');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');

  const [summary, setSummary] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [weekday, setWeekday] = useState([]);
  const [buckets, setBuckets] = useState(null);
  const [queuesBreakdown, setQueuesBreakdown] = useState([]);
  const [citiesRanking, setCitiesRanking] = useState([]);
  const [daySchedule, setDaySchedule] = useState(null);

  const timeseriesRef = useRef(null);
  const weekdayRef = useRef(null);
  const bucketsRef = useRef(null);
  const chartsRef = useRef({});
  const [autoLoaded, setAutoLoaded] = useState(false);

  const defaultRange = () => {
    const today = new Date();
    const fromDate = new Date();
    fromDate.setDate(today.getDate() - 30);
    const format = (d) => d.toISOString().slice(0, 10);
    return { from: format(fromDate), to: format(today) };
  };

  const updateStatus = (text, kind = '') => {
    setStatus({ text, kind });
  };

  const fetchJson = async (url) => {
    const res = await fetch(url);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = data && data.error ? data.error : 'Помилка запиту';
      throw new Error(msg);
    }
    return data;
  };

  const ensureDates = () => {
    const fallback = defaultRange();
    const fromValue = from || fallback.from;
    const toValue = to || fallback.to;
    const dateValue = date || fallback.to;
    if (!from) setFrom(fromValue);
    if (!to) setTo(toValue);
    if (!date) setDate(dateValue);
    return { fromValue, toValue, dateValue };
  };

  const loadCities = async () => {
    try {
      const data = await fetchJson('/api/cities');
      setCities(data.cities || []);
    } catch (err) {
      updateStatus('Не вдалося завантажити міста', 'error');
    }
  };

  const reloadQueues = async () => {
    if (!selectedCity) return;
    const { fromValue, toValue, dateValue } = ensureDates();
    const params = new URLSearchParams();
    params.set('channel_id', selectedCity);
    if (mode === 'range') {
      params.set('from', fromValue);
      params.set('to', toValue);
    } else {
      params.set('from', dateValue);
      params.set('to', dateValue);
    }

    try {
      const data = await fetchJson(`/api/stats/queues-list?${params.toString()}`);
      const nextQueues = data.available_queues || [];
      setQueues(nextQueues);
      if (selectedQueue !== 'union' && !nextQueues.includes(selectedQueue)) {
        setSelectedQueue('union');
      }
    } catch (err) {
      updateStatus('Не вдалося завантажити черги', 'error');
    }
  };

  const loadRange = async () => {
    if (!selectedCity) return;
    updateStatus('Завантаження...', '');
    const { fromValue, toValue } = ensureDates();

    const params = new URLSearchParams({ channel_id: selectedCity, from: fromValue, to: toValue });
    if (selectedQueue && selectedQueue !== 'union') params.set('queue', selectedQueue);

    try {
      const [summaryRes, timeseriesRes, heatmapRes, weekdayRes, bucketsRes, queuesRes, citiesRes, coverageRes] =
        await Promise.all([
          fetchJson(`/api/stats/summary?${params}`),
          fetchJson(`/api/stats/timeseries?${params}`),
          fetchJson(`/api/stats/heatmap?${params}`),
          fetchJson(`/api/stats/weekday?${params}`),
          fetchJson(`/api/stats/buckets?${params}`),
          fetchJson(`/api/stats/queues?${params}`),
          fetchJson(`/api/stats/cities?from=${params.get('from')}&to=${params.get('to')}`),
          fetchJson(`/api/stats/coverage?${params}`),
        ]);

      setSummary(summaryRes);
      setTimeseries(timeseriesRes.points || []);
      setHeatmap(heatmapRes);
      setWeekday(weekdayRes.weekdays || []);
      setBuckets(bucketsRes);
      setQueuesBreakdown(queuesRes.queues || []);
      setCitiesRanking(citiesRes.cities || []);
      setCoverage(coverageRes);
      setDaySchedule(null);

      updateStatus('Готово', 'success');
    } catch (err) {
      updateStatus(err.message || 'Помилка', 'error');
    }
  };

  const loadDay = async () => {
    if (!selectedCity) return;
    updateStatus('Завантаження...', '');
    const { dateValue } = ensureDates();

    const dayParams = new URLSearchParams({ channel_id: selectedCity, date: dateValue });
    if (selectedQueue && selectedQueue !== 'union') dayParams.set('queue', selectedQueue);

    const rangeParams = new URLSearchParams({ channel_id: selectedCity, from: dateValue, to: dateValue });
    if (selectedQueue && selectedQueue !== 'union') rangeParams.set('queue', selectedQueue);

    try {
      const [summaryRes, bucketsRes, queuesRes, dayRes] = await Promise.all([
        fetchJson(`/api/stats/summary?${rangeParams}`),
        fetchJson(`/api/stats/buckets?${rangeParams}`),
        fetchJson(`/api/stats/queues?${rangeParams}`),
        fetchJson(`/api/stats/day?${dayParams}`),
      ]);

      setSummary(summaryRes);
      setBuckets(bucketsRes);
      setQueuesBreakdown(queuesRes.queues || []);
      setDaySchedule(dayRes);
      setCoverage(null);
      setHeatmap(null);
      setTimeseries([]);
      setWeekday([]);
      setCitiesRanking([]);

      updateStatus('Готово', 'success');
    } catch (err) {
      updateStatus(err.message || 'Помилка', 'error');
    }
  };

  const formatHours = (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return Number(value).toFixed(2);
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${Number(value).toFixed(2)}%`;
  };

  const minutesToHours = (minutes) => {
    if (!minutes) return 0;
    return Math.round((minutes / 60) * 100) / 100;
  };

  const heatColor = (value) => {
    const t = Math.max(0, Math.min(100, value)) / 100;
    const light = 85 - t * 50;
    return `hsl(215, 80%, ${light}%)`;
  };

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const baseChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
        labels: { color: css('--text-secondary') },
      },
    },
    scales: {
      x: {
        ticks: { color: css('--text-secondary') },
        grid: { color: css('--border') },
      },
      y: {
        ticks: { color: css('--text-secondary') },
        grid: { color: css('--border') },
      },
    },
  });

  const createChart = (key, canvas, config) => {
    if (chartsRef.current[key]) {
      chartsRef.current[key].destroy();
      chartsRef.current[key] = null;
    }
    if (!canvas || !config) return;
    chartsRef.current[key] = new Chart(canvas, config);
  };

  useEffect(() => {
    const range = defaultRange();
    setFrom(range.from);
    setTo(range.to);
    setDate(range.to);
  }, []);

  useEffect(() => {
    loadCities();
  }, []);

  useEffect(() => {
    if (!selectedCity && cities.length > 0) {
      setSelectedCity(String(cities[0].id));
    }
  }, [cities, selectedCity]);

  useEffect(() => {
    if (selectedCity) {
      reloadQueues();
    }
  }, [selectedCity, mode]);

  useEffect(() => {
    if (!autoLoaded && selectedCity && from && to) {
      setAutoLoaded(true);
      loadRange();
    }
  }, [autoLoaded, selectedCity, from, to]);

  useEffect(() => {
    if (!timeseriesRef.current) return;
    const labels = timeseries.map((p) => p.date.slice(5));
    const data = timeseries.map((p) => p.off_hours);
    const config = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Години без світла',
            data,
            borderColor: css('--primary'),
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            tension: 0.3,
            fill: true,
            pointRadius: 3,
          },
        ],
      },
      options: baseChartOptions(),
    };
    createChart('timeseries', timeseriesRef.current, config);
  }, [timeseries, theme]);

  useEffect(() => {
    if (!weekdayRef.current) return;
    const labels = weekday.map((w) => w.name);
    const data = weekday.map((w) => w.avg_off_hours);
    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Сер. год/день',
            data,
            backgroundColor: 'rgba(59, 130, 246, 0.45)',
            borderRadius: 8,
          },
        ],
      },
      options: baseChartOptions(),
    };
    createChart('weekday', weekdayRef.current, config);
  }, [weekday, theme]);

  useEffect(() => {
    if (!bucketsRef.current) return;
    if (!buckets) {
      createChart('buckets', bucketsRef.current, null);
      return;
    }
    const config = {
      type: 'bar',
      data: {
        labels: ['Ранок', 'День', 'Вечір', 'Ніч'],
        datasets: [
          {
            label: 'Сер. год/день',
            data: [buckets.morning, buckets.day, buckets.evening, buckets.night],
            backgroundColor: [
              'rgba(59, 130, 246, 0.45)',
              'rgba(34, 197, 94, 0.45)',
              'rgba(251, 146, 60, 0.45)',
              'rgba(99, 102, 241, 0.45)',
            ],
            borderRadius: 8,
          },
        ],
      },
      options: baseChartOptions(),
    };
    createChart('buckets', bucketsRef.current, config);
  }, [buckets, theme]);

  const heroText = mode === 'day'
    ? `Дата ${date || '—'}`
    : from && to
      ? `${from} — ${to}`
      : 'Останні 30 днів';

  const queueLabel = selectedQueue && selectedQueue !== 'union'
    ? `Черга: ${selectedQueue}`
    : 'Черга: всі';

  const summaryPeriod = summary?.period
    ? `${summary.period.from} — ${summary.period.to} (${summary.period.days_with_data}/${summary.period.days_total} днів)`
    : '—';

  const typical = heatmap?.typical_window;

  return (
    <div className="stats-page">
      <section className="hero">
        <div>
          <div className="hero-title">Статистика відключень</div>
          <div className="hero-subtitle">
            Порівнюйте надійність, дивіться теплову мапу та аналізуйте черги за обраний період.
          </div>
        </div>
        <div className="hero-badge">{heroText}</div>
      </section>

      {mode === 'day' && daySchedule?.emergency_outages && (
        <div className="stats-emergency-banner">
          <strong>Увага:</strong>
          <span> Аварійні відключення активні. Дані можуть бути нестабільними.</span>
        </div>
      )}

      <div className="grid-layout">
        <div className="left-panel">
          <div className="card controls-card">
            <div className="card-header">
              <div>
                <div className="card-title">Параметри</div>
                <div className="card-subtitle">Оберіть місто, чергу та режим</div>
              </div>
              <span className="badge">{queueLabel}</span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="city">Місто</label>
                <select id="city" value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)}>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>{city.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="queue">Черга</label>
                <select id="queue" value={selectedQueue} onChange={(e) => setSelectedQueue(e.target.value)}>
                  <option value="union">Всі черги</option>
                  {queues.map((queue) => (
                    <option key={queue} value={queue}>Черга {queue}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Режим</label>
                <div className="mode-toggle">
                  <button
                    type="button"
                    className={`mode-btn ${mode === 'range' ? 'active' : ''}`}
                    onClick={() => setMode('range')}
                  >
                    Діапазон
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${mode === 'day' ? 'active' : ''}`}
                    onClick={() => setMode('day')}
                  >
                    Конкретна дата
                  </button>
                </div>
              </div>
              {mode === 'range' ? (
                <div className="field">
                  <label>Період</label>
                  <div className="mode-toggle" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="specific-date">Дата</label>
                  <input id="specific-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              )}
            </div>

            <div className="actions">
              <button className="btn-primary" onClick={() => (mode === 'range' ? loadRange() : loadDay())}>
                Показати статистику
              </button>
              <button className="btn-secondary" onClick={reloadQueues}>Оновити черги</button>
              <div className="status-line">
                <span>Статус:</span>
                <span className={`status ${status.kind}`}>{status.text}</span>
              </div>
            </div>
          </div>

          {mode === 'range' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Покриття даних</div>
                  <div className="card-subtitle">Скільки днів у базі за період</div>
                </div>
              </div>
              <div className="coverage-progress">
                <div className="coverage-bar" style={{ width: `${coverage?.coverage_percent || 0}%` }}></div>
              </div>
              <div className="coverage-meta">
                <span>{formatPercent(coverage?.coverage_percent || 0)}</span>
                <span>{coverage ? `${coverage.days_with_data}/${coverage.expected_days} днів` : '—'}</span>
              </div>
              <div className="missing-dates">
                {coverage?.missing_dates?.length
                  ? `Відсутні дати: ${coverage.missing_dates.join(', ')}`
                  : 'Всі дні присутні в базі'}
              </div>
            </div>
          )}
        </div>

        <div className="right-panel">
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Зведення</div>
                <div className="card-subtitle">{summaryPeriod}</div>
              </div>
              <span className="badge">{queueLabel}</span>
            </div>

            <div className="stat-grid">
              <div className="stat-card">
                <div className="label">Надійність</div>
                <div className="value">{formatPercent(summary?.reliability_percent)}</div>
                <div className="desc">% часу зі світлом</div>
              </div>
              <div className="stat-card">
                <div className="label">Середнє без світла</div>
                <div className="value">{formatHours(summary?.avg_off_hours_per_day)}</div>
                <div className="desc">год/день</div>
              </div>
              <div className="stat-card">
                <div className="label">Загальні години</div>
                <div className="value">{formatHours(summary?.total_off_hours)}</div>
                <div className="desc">годин за період</div>
              </div>
              <div className="stat-card">
                <div className="label">Серії відключень</div>
                <div className="value">{formatHours(summary?.avg_blocks_per_day)}</div>
                <div className="desc">блоків/день</div>
              </div>
              <div className="stat-card">
                <div className="label">Найдовша темна серія</div>
                <div className="value">{formatHours(minutesToHours(summary?.longest_blackout_streak_minutes))}</div>
                <div className="desc">годин поспіль</div>
              </div>
              <div className="stat-card">
                <div className="label">Аварійні дні</div>
                <div className="value">{formatPercent(summary?.emergency_rate_percent)}</div>
                <div className="desc">% від днів</div>
              </div>
            </div>

            <div className="summary-lists">
              <div>
                <div className="card-title" style={{ fontSize: '1rem' }}>Найгірші дні</div>
                <ul className="mini-list">
                  {(summary?.top_worst_days || []).map((item) => (
                    <li key={`worst-${item.date}`}>
                      <span>{item.date}</span>
                      <span>{formatHours(item.off_hours)} год</span>
                    </li>
                  ))}
                  {(!summary?.top_worst_days || summary.top_worst_days.length === 0) && <li>—</li>}
                </ul>
              </div>
              <div>
                <div className="card-title" style={{ fontSize: '1rem' }}>Найкращі дні</div>
                <ul className="mini-list">
                  {(summary?.top_best_days || []).map((item) => (
                    <li key={`best-${item.date}`}>
                      <span>{item.date}</span>
                      <span>{formatHours(item.off_hours)} год</span>
                    </li>
                  ))}
                  {(!summary?.top_best_days || summary.top_best_days.length === 0) && <li>—</li>}
                </ul>
              </div>
            </div>
          </div>

          {mode === 'day' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Графік дня</div>
                  <div className="card-subtitle">{daySchedule?.date || '—'}</div>
                </div>
                <span className="badge">{daySchedule?.emergency_outages ? 'Аварійно' : 'Звичайний'}</span>
              </div>
              <div className="queue-grid">
                {daySchedule?.queues?.length ? (
                  daySchedule.queues.map((queue) => (
                    <div key={queue.queue} className="queue-card">
                      <h4>Черга {queue.queue}</h4>
                      <div className="card-subtitle">Без світла: {formatHours(queue.off_hours)} год</div>
                      <div className="queue-periods">
                        {(queue.periods && queue.periods.length ? queue.periods : ['—']).map((p, idx) => (
                          <span key={`${queue.queue}-${idx}`} className="period-pill">{p}</span>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">Немає даних за цю дату</div>
                )}
              </div>
            </div>
          )}

          {mode === 'range' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Часовий ряд</div>
                  <div className="card-subtitle">Години відключень по днях</div>
                </div>
              </div>
              <div className="chart-box">
                <canvas ref={timeseriesRef}></canvas>
              </div>
            </div>
          )}

          {mode === 'range' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Теплова мапа доби</div>
                  <div className="card-subtitle">% днів з відключенням у кожну годину</div>
                </div>
              </div>
              <div className="stat-grid">
                {typical && (
                  <>
                    <div className="stat-card">
                      <div className="label">Перший викл.</div>
                      <div className="value">{typical.avg_first_off || '—'}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Останнє вкл.</div>
                      <div className="value">{typical.avg_last_on || '—'}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Домінантний старт</div>
                      <div className="value">{typical.avg_dominant_start || '—'}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Домінантний кінець</div>
                      <div className="value">{typical.avg_dominant_end || '—'}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Днів із відключеннями</div>
                      <div className="value">{typical.days_with_outage}</div>
                    </div>
                  </>
                )}
              </div>
              <div className="heatmap-grid">
                {heatmap?.hours?.length ? (
                  heatmap.hours.map((value, hour) => (
                    <div
                      key={`hour-${hour}`}
                      className="heatmap-cell"
                      style={{ background: heatColor(value) }}
                    >
                      <span>{String(hour).padStart(2, '0')}:00</span>
                      <span>{value.toFixed(1)}%</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">Немає даних для теплової мапи</div>
                )}
              </div>
              <div className="heatmap-legend">
                <span>Менше відключень</span>
                <span>Більше відключень</span>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Дні тижня</div>
                <div className="card-subtitle">Середня тривалість відключень</div>
              </div>
            </div>
            <div className="chart-box">
              <canvas ref={weekdayRef}></canvas>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Періоди доби</div>
                <div className="card-subtitle">Ранок, день, вечір, ніч</div>
              </div>
            </div>
            <div className="chart-box">
              <canvas ref={bucketsRef}></canvas>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Черги</div>
                <div className="card-subtitle">Порівняння всіх черг у місті</div>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Черга</th>
                  <th>Сер. год/день</th>
                  <th>Надійність</th>
                  <th>Днів</th>
                </tr>
              </thead>
              <tbody>
                {queuesBreakdown.length ? (
                  queuesBreakdown.map((queue) => (
                    <tr key={`queue-${queue.queue}`}>
                      <td>{queue.queue}</td>
                      <td>{formatHours(queue.avg_off_hours)}</td>
                      <td>{formatPercent(queue.reliability_percent)}</td>
                      <td>{queue.days_with_data}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>Дані відсутні</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {mode === 'range' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Рейтинг міст</div>
                  <div className="card-subtitle">Надійність за період</div>
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Місто</th>
                    <th>Надійність</th>
                    <th>Сер. год/день</th>
                    <th>Днів</th>
                  </tr>
                </thead>
                <tbody>
                  {citiesRanking.length ? (
                    citiesRanking.map((city) => (
                      <tr key={`city-${city.channel_id}`}>
                        <td>{city.city_name}</td>
                        <td>{formatPercent(city.reliability_percent)}</td>
                        <td>{formatHours(city.avg_off_hours_per_day)}</td>
                        <td>{city.days_with_data}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>Дані відсутні</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .stats-page {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .hero {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
        }

        .hero-title {
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 6px;
        }

        .hero-subtitle {
          color: var(--text-secondary);
          font-size: 1.05rem;
          max-width: 600px;
          line-height: 1.6;
        }

        .hero-badge {
          padding: 8px 16px;
          border-radius: 999px;
          background: var(--bg-element);
          color: var(--text-secondary);
          font-weight: 600;
          font-size: 0.9rem;
          border: 1px solid var(--border);
        }

        .grid-layout {
          display: grid;
          grid-template-columns: 380px minmax(0, 1fr);
          gap: 32px;
          align-items: start;
        }

        .left-panel,
        .right-panel {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .card {
          background: var(--bg-card);
          border-radius: 24px;
          padding: 24px;
          box-shadow: var(--shadow);
          border: 1px solid transparent;
          transition: background 0.3s;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .card-title {
          font-size: 1.3rem;
          font-weight: 700;
        }

        .card-subtitle {
          color: var(--text-secondary);
          font-size: 0.9rem;
          margin-top: 4px;
        }

        .controls-card {
          position: sticky;
          top: 90px;
        }

        .form-grid {
          display: grid;
          gap: 14px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field label {
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary);
          font-weight: 600;
        }

        select,
        input,
        button {
          background: var(--bg-element);
          color: var(--text-main);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px 14px;
          font-size: 0.95rem;
          font-family: inherit;
          outline: none;
          transition: all 0.2s;
        }

        select:focus,
        input:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }

        .mode-toggle {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .mode-btn {
          background: var(--bg-element);
          color: var(--text-secondary);
          font-weight: 600;
          cursor: pointer;
          border-radius: 12px;
          border: 1px solid var(--border);
        }

        .mode-btn.active {
          background: var(--primary);
          color: #ffffff;
          border-color: transparent;
          box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3);
        }

        .actions {
          display: grid;
          gap: 10px;
          margin-top: 6px;
        }

        .btn-primary {
          background: var(--primary);
          color: white;
          border: none;
          font-weight: 600;
          cursor: pointer;
        }

        .btn-primary:hover {
          background: var(--primary-hover);
        }

        .btn-secondary {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border);
          cursor: pointer;
        }

        .btn-secondary:hover {
          color: var(--primary);
          border-color: var(--primary);
        }

        .status-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .status-line span {
          font-weight: 600;
        }

        .status.success {
          color: var(--status-green-text);
        }

        .status.error {
          color: var(--status-red-text);
        }

        .badge {
          padding: 6px 12px;
          border-radius: 999px;
          background: var(--bg-element);
          color: var(--text-secondary);
          border: 1px solid var(--border);
          font-size: 0.85rem;
          font-weight: 600;
        }

        .stats-emergency-banner {
          height: 44px;
          background-color: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 12px;
          padding: 0 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          color: #991b1b;
          box-shadow: 0 2px 10px rgba(239, 68, 68, 0.05);
          animation: slideDown 0.3s ease-out;
        }

        [data-theme="dark"] .stats-emergency-banner {
          background-color: #450a0a;
          border-color: #7f1d1d;
          color: #fca5a5;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }

        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
        }

        .stat-card {
          background: var(--bg-element);
          border-radius: 16px;
          padding: 12px 14px;
          border: 1px solid var(--border);
        }

        .stat-card .label {
          font-size: 0.75rem;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .stat-card .value {
          font-size: 1.3rem;
          font-weight: 700;
          margin-top: 6px;
        }

        .stat-card .desc {
          font-size: 0.8rem;
          color: var(--text-secondary);
          margin-top: 2px;
        }

        .summary-lists {
          margin-top: 16px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .mini-list {
          list-style: none;
          display: grid;
          gap: 6px;
          margin-top: 10px;
        }

        .mini-list li {
          display: flex;
          justify-content: space-between;
          padding: 8px 10px;
          background: var(--bg-element);
          border-radius: 10px;
          font-size: 0.9rem;
          color: var(--text-main);
        }

        .chart-box {
          height: 320px;
        }

        .chart-box canvas {
          width: 100% !important;
          height: 100% !important;
        }

        .heatmap-grid {
          display: grid;
          grid-template-columns: repeat(12, minmax(0, 1fr));
          gap: 8px;
          margin-top: 12px;
        }

        .heatmap-grid .empty-state {
          grid-column: 1 / -1;
          min-height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .heatmap-cell {
          height: 56px;
          border-radius: 14px;
          padding: 8px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          color: #ffffff;
          font-weight: 600;
          font-size: 0.85rem;
        }

        .heatmap-cell span {
          opacity: 0.9;
        }

        .heatmap-legend {
          display: flex;
          justify-content: space-between;
          margin-top: 8px;
          color: var(--text-secondary);
          font-size: 0.8rem;
        }

        .table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }

        .table th,
        .table td {
          text-align: left;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border);
        }

        .table th {
          color: var(--text-secondary);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .table tbody tr:hover {
          background: var(--bg-element);
        }

        .coverage-progress {
          width: 100%;
          height: 12px;
          background: var(--bg-element);
          border-radius: 999px;
          overflow: hidden;
          margin-top: 10px;
        }

        .coverage-bar {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #3b82f6);
          width: 0;
          transition: width 0.4s ease;
        }

        .coverage-meta {
          margin-top: 8px;
          display: flex;
          justify-content: space-between;
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .missing-dates {
          margin-top: 10px;
          font-size: 0.85rem;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .queue-grid {
          display: grid;
          gap: 12px;
        }

        .queue-card {
          padding: 14px;
          border-radius: 14px;
          background: var(--bg-element);
          border: 1px solid var(--border);
        }

        .queue-card h4 {
          font-size: 1rem;
          margin-bottom: 6px;
        }

        .queue-periods {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .period-pill {
          padding: 6px 10px;
          border-radius: 999px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          font-size: 0.85rem;
          color: var(--text-main);
        }

        .empty-state {
          padding: 20px;
          background: var(--bg-element);
          border-radius: 16px;
          text-align: center;
          color: var(--text-secondary);
        }

        @media (max-width: 1100px) {
          .grid-layout {
            grid-template-columns: 320px minmax(0, 1fr);
          }
        }

        @media (max-width: 900px) {
          .grid-layout {
            grid-template-columns: 1fr;
          }

          .controls-card {
            position: static;
          }

          .summary-lists {
            grid-template-columns: 1fr;
          }

          .hero {
            flex-direction: column;
            align-items: flex-start;
          }

          .hero-badge {
            align-self: flex-start;
          }
        }
      `}</style>
    </div>
  );
};

export default StatsPage;

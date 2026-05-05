import React, { useState } from 'react';
import { Search, PieChart, Clock } from 'lucide-react';

const ScheduleResult = ({ scheduleData }) => {
    const [isClockView, setIsClockView] = useState(false);

    const StyleBlock = () => (
        <style>{`
      .empty-card {
        min-height: 600px; height: 100%;
        border: 2px dashed var(--primary); 
        background-color: var(--bg-card);
        border-radius: 24px;
        box-shadow: var(--shadow);
        display: flex; align-items: center; justify-content: center; text-align: center; padding: 40px;
      }
      .empty-content { display: flex; flex-direction: column; align-items: center; max-width: 320px; }
      .icon-search {
        width: 150px; height: 150px; color: var(--text-main); stroke-width: 2.5; margin-bottom: 30px; opacity: 0.9;
      }
      .empty-card h3 { font-size: 1.8rem; font-weight: 800; color: var(--text-main); margin-bottom: 16px; }
      .empty-card p { color: var(--text-secondary); font-size: 1.05rem; line-height: 1.6; }

      .results-wrapper { display: flex; flex-direction: column; gap: 20px; }

      .card {
        background: var(--bg-card);
        border-radius: 24px; padding: 30px; box-shadow: var(--shadow);
        position: relative; transition: background 0.3s;
      }

      .toggle-view-btn {
        position: absolute; top: 20px; right: 20px; width: 40px; height: 40px;
        border-radius: 12px; border: 1px solid var(--border);
        background: var(--bg-element); color: var(--text-secondary);
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s; z-index: 10;
      }
      .toggle-view-btn:hover { border-color: var(--primary); color: var(--primary); }

      .chart-container {
        display: flex; align-items: center; justify-content: center; gap: 60px; flex-wrap: wrap; min-height: 220px;
      }
      .donut-chart, .clock-chart {
        width: 200px; height: 200px; border-radius: 50%; position: relative;
        display: flex; align-items: center; justify-content: center;
      }
      .clock-wrapper { position: relative; padding: 20px; }
      .clock-separators {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 50%;
        background: repeating-conic-gradient(transparent 0deg 14deg, var(--bg-card) 14deg 15deg);
        z-index: 2;
      }
      .clock-labels span {
        position: absolute; font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);
      }
      .label-00 { top: 0; left: 50%; transform: translateX(-50%); }
      .label-06 { right: 0; top: 50%; transform: translateY(-50%); }
      .label-12 { bottom: 0; left: 50%; transform: translateX(-50%); }
      .label-18 { left: 0; top: 50%; transform: translateY(-50%); }

      .donut-hole {
        width: 130px; height: 130px; background: var(--bg-card); border-radius: 50%;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        line-height: 1.1; z-index: 3; box-shadow: 0 0 20px rgba(0,0,0,0.05);
      }
      .percent-text { font-size: 2.2rem; font-weight: 700; color: var(--text-main); }
      .label-text { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 2px; }
      .hours-text { font-size: 1.2rem; font-weight: 600; color: var(--text-main); }

      .chart-legend { display: flex; flex-direction: column; gap: 15px; }
      .legend-item { display: flex; align-items: center; gap: 10px; font-weight: 500; font-size: 1.05rem; color: var(--text-main); }
      .dot { width: 16px; height: 16px; border-radius: 50%; }
      .dot-green { background: #22c55e; }
      .dot-red { background: #ef4444; }

      .list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; }
      .list-header h2 { font-size: 1.5rem; font-weight: 600; color: var(--text-main); }
      .date-badge { background: var(--primary); color: white; padding: 6px 16px; border-radius: 20px; font-weight: 500; font-size: 0.95rem; }

      .intervals-list { display: flex; flex-direction: column; gap: 10px; }
      .interval-row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 16px 20px; border-radius: 12px; font-size: 1.1rem;
      }
      .row-on { background-color: var(--status-green-bg); color: var(--status-green-text); }
      .row-off { background-color: var(--status-red-bg); color: var(--status-red-text); }
      .status-label { font-weight: 600; }
      .time-range { font-weight: 500; letter-spacing: 0.5px; }
    `}
        </style>
    );

    //Початкова форма результату без графіків
    if (!scheduleData) {
        return (
            <div className="empty-card">
                <div className="empty-content">
                    <Search className="icon-search" />
                    <h3>Графік не обрано</h3>
                    <p>Будь ласка, вкажіть вашу адресу в панелі зліва, щоб побачити розклад відключень.</p>
                </div>
                <StyleBlock />
            </div>
        );
    }

    //Статистика дня (всередині діаграми)
    const { timeline, stats, day } = scheduleData;
    const offPercentage = stats.percentage;
    const offHoursText = Math.round(stats.totalOffMinutes / 60);

    //Діаграма
    const formatDate = (isoDate) => {
        if (!isoDate) return '';
        const parts = isoDate.split('-');
        if (parts.length !== 3) return isoDate;
        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    };

    //Діаграма годинник
    const generateClockGradient = () => {
        const stops = timeline.map(item => {
            const startMin = timeToMinutes(item.start);
            const endMin = timeToMinutes(item.end);
            const startDeg = startMin * 0.25;
            const endDeg = endMin * 0.25;
            const color = item.type === 'off' ? '#ef4444' : '#22c55e';
            return `${color} ${startDeg}deg ${endDeg}deg`;
        });
        return `conic-gradient(${stops.join(', ')})`;
    };

    //Розбивка годин в хвилини
    const timeToMinutes = (timeStr) => {
        if (timeStr === "24:00") return 1440;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    return (
        <div className="results-wrapper">
            <div className="card chart-card">

                {/*Кнопка перемкнення діаграми*/}
                <button
                    className="toggle-view-btn"
                    onClick={() => setIsClockView(!isClockView)}
                    title={isClockView ? "Показати звичайну діаграму" : "Показати погодинний циферблат"}
                >
                    {isClockView ? <PieChart size={20} /> : <Clock size={20} />}
                </button>

                <div className="chart-container">
                    {isClockView ? (
                        <div className="clock-wrapper">
                            <div className="clock-labels">
                                <span className="label-00">00</span>
                                <span className="label-06">06</span>
                                <span className="label-12">12</span>
                                <span className="label-18">18</span>
                            </div>
                            <div className="clock-chart" style={{ background: generateClockGradient() }}>
                                <div className="clock-separators"></div>
                                <div className="donut-hole">
                                    <span className="percent-text">{offPercentage}%</span>
                                    <span className="label-text">Без світла</span>
                                    <span className="hours-text">~{offHoursText} год</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="donut-chart" style={{
                            background: `conic-gradient(#ef4444 0% ${offPercentage}%, #22c55e ${offPercentage}% 100%)`
                        }}>
                            <div className="donut-hole">
                                <span className="percent-text">{offPercentage}%</span>
                                <span className="label-text">Без світла</span>
                                <span className="hours-text">~{offHoursText} год</span>
                            </div>
                        </div>
                    )}
                    <div className="chart-legend">
                        <div className="legend-item"><span className="dot dot-green"></span><span>Є світло</span></div>
                        <div className="legend-item"><span className="dot dot-red"></span><span>Немає світла</span></div>
                    </div>
                </div>
            </div>

            <div className="card list-card">
                <div className="list-header">
                    <h2>Графік світла</h2>
                    <div className="date-badge">{formatDate(day)}</div>
                </div>
                <div className="intervals-list">
                    {timeline.map((interval, index) => {
                        const isOff = interval.type === 'off';
                        return (
                            <div key={index} className={`interval-row ${isOff ? 'row-off' : 'row-on'}`}>
                                <span className="time-range">{interval.start}-{interval.end}</span>
                                <span className="status-label">{isOff ? 'немає світла' : 'Світло є'}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
            <StyleBlock />
        </div>
    );
};

export default ScheduleResult;
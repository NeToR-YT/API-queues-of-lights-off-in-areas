const API = '/api';

export const fetchSchedule = async (requestData) => {
    const targetDate = requestData.date;
    const regionId = Number(requestData.region);
    const requestedGroup = requestData.group;

    try {
        let doc = null;

        // Спробуємо today
        const todayRes = await fetch(`${API}/schedules/today?channel_id=${regionId}`);
        if (todayRes.ok) {
            const todayData = await todayRes.json();
            if (todayData.date === targetDate) {
                doc = todayData;
            } else if (targetDate > todayData.date) {
                // Спробуємо tomorrow
                const tomorrowRes = await fetch(`${API}/schedules/tomorrow?channel_id=${regionId}`);
                if (tomorrowRes.ok) {
                    const tomorrowData = await tomorrowRes.json();
                    if (tomorrowData.date === targetDate) doc = tomorrowData;
                }
            }
        }

        // Якщо не today/tomorrow — шукаємо в history
        if (!doc) {
            const histRes = await fetch(`${API}/schedules?channel_id=${regionId}&date=${targetDate}`);
            if (!histRes.ok) throw new Error(`Дані за ${targetDate} відсутні.`);
            doc = await histRes.json();
        }

        if (!doc.schedule[requestedGroup]) {
            throw new Error(`Дані для черги ${requestedGroup} відсутні.`);
        }

        const { timeline, stats } = generateExactTimeline(doc.schedule[requestedGroup]);

        return {
            region: regionId,
            group: requestedGroup,
            day: targetDate,
            timeline,
            stats,
            emergencyOutages: doc.emergency_outages ?? false,
        };
    } catch (error) {
        console.error('Помилка API:', error);
        throw error;
    }
};

export const getCalendarInfo = async (regionId) => {
    const info = { todayDate: null, availableDates: new Set() };

    // Отримуємо today
    try {
        const res = await fetch(`${API}/schedules/today?channel_id=${regionId}`);
        if (res.ok) {
            const data = await res.json();
            info.todayDate = data.date;
            if (regionId) info.availableDates.add(data.date);
        }
    } catch (e) {}

    if (!regionId) return { todayDate: info.todayDate, availableDates: [] };

    // Отримуємо tomorrow
    try {
        const res = await fetch(`${API}/schedules/tomorrow?channel_id=${regionId}`);
        if (res.ok) {
            const data = await res.json();
            if (data.date) info.availableDates.add(data.date);
        }
    } catch (e) {}

    // Отримуємо доступні дати з архіву через timeseries (останні 60 днів)
    try {
        const today = new Date();
        const from = new Date();
        from.setDate(today.getDate() - 60);
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = today.toISOString().slice(0, 10);

        const res = await fetch(`${API}/stats/timeseries?channel_id=${regionId}&from=${fromStr}&to=${toStr}`);
        if (res.ok) {
            const data = await res.json();
            data.points?.forEach(p => info.availableDates.add(p.date));
        }
    } catch (e) {}

    return {
        todayDate: info.todayDate,
        availableDates: Array.from(info.availableDates).sort(),
    };
};

const generateExactTimeline = (offRangesStr) => {
    let offIntervals = offRangesStr.map(range => {
        const [startStr, endStr] = range.split('-');
        let start = timeToMinutes(startStr);
        let end = timeToMinutes(endStr);
        if (end === 0 && start !== 0) end = 1440;
        return { start, end };
    });
    offIntervals.sort((a, b) => a.start - b.start);
    const timeline = [];
    let currentCursor = 0;
    let totalOffMinutes = 0;
    offIntervals.forEach(off => {
        if (off.start > currentCursor) {
            timeline.push({ start: minutesToTime(currentCursor), end: minutesToTime(off.start), type: 'on' });
        }
        if (off.end > off.start) {
            timeline.push({ start: minutesToTime(off.start), end: minutesToTime(off.end), type: 'off' });
            totalOffMinutes += (off.end - off.start);
            currentCursor = Math.max(currentCursor, off.end);
        }
    });
    if (currentCursor < 1440) {
        timeline.push({ start: minutesToTime(currentCursor), end: '24:00', type: 'on' });
    }
    return { timeline, stats: { totalOffMinutes, percentage: Math.round((totalOffMinutes / 1440) * 100) } };
};

const timeToMinutes = (timeStr) => {
    if (timeStr === '24:00') return 1440;
    const [h, m] = timeStr.trim().split(':').map(Number);
    return h * 60 + m;
};

const minutesToTime = (minutes) => {
    if (minutes === 1440) return '24:00';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

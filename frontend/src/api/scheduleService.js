const FILES = {
    cities: '/cities.json',
    today: '/schedule_today.json',
    tomorrow: '/schedule_tomorrow.json',
    historyBase: '/schedule_history_'
};

export const fetchSchedule = async (requestData) => {
    const targetDate = requestData.date;
    const regionId = Number(requestData.region);

    try {
        const source = await determineSourceForDate(targetDate, regionId);

        if (!source) {
            throw new Error(`Дані за ${targetDate} відсутні.`);
        }

        const response = await fetch(source.url);
        if (!response.ok) throw new Error(`Не вдалося завантажити файл ${source.url}`);

        const dataArray = await response.json();
        let dayData = null;

        if (Array.isArray(dataArray)) {
            dayData = dataArray.find(item =>
                item.schedule_date === targetDate && item.channel_id === regionId
            );
        } else {
            dayData = dataArray[targetDate];
        }

        if (!dayData || !dayData.schedule) {
            throw new Error(`Графік для регіону (ID: ${regionId}) на ${targetDate} не знайдено.`);
        }

        const schedule = dayData.schedule;
        const requestedGroup = requestData.group;

        // --- НОВЕ: Отримуємо статус аварійних відключень ---
        // Якщо поля немає в JSON, вважаємо що false
        const isEmergency = dayData.emergency_outages || false;

        if (!schedule[requestedGroup]) {
            throw new Error(`Дані для черги ${requestedGroup} відсутні.`);
        }

        const { timeline, stats } = generateExactTimeline(schedule[requestedGroup]);

        return {
            region: regionId,
            group: requestedGroup,
            day: targetDate,
            timeline: timeline,
            stats: stats,
            emergencyOutages: isEmergency // <--- Передаємо цей прапорець у результат
        };

    } catch (error) {
        console.error("Помилка API:", error);
        throw error;
    }
};

// --- (Решта файлу без змін) ---
export const getCalendarInfo = async (regionId) => {
    const info = { todayDate: null, availableDates: new Set() };
    try {
        const todayRes = await fetch(FILES.today);
        if (todayRes.ok) {
            const data = await todayRes.json();
            if (Array.isArray(data) && data.length > 0) {
                info.todayDate = data[0].schedule_date;
                if (regionId) {
                    const hasRegion = data.some(d => d.channel_id === Number(regionId));
                    if (hasRegion) info.availableDates.add(info.todayDate);
                }
            }
        }
        if (!regionId) return { todayDate: info.todayDate, availableDates: [] };
        const rId = Number(regionId);
        try {
            const tmrRes = await fetch(FILES.tomorrow);
            if (tmrRes.ok) {
                const data = await tmrRes.json();
                if (Array.isArray(data)) {
                    const hasRegion = data.some(d => d.channel_id === rId);
                    if (hasRegion && data[0]?.schedule_date) info.availableDates.add(data[0].schedule_date);
                }
            }
        } catch (e) {}
        try {
            const historyUrl = `${FILES.historyBase}${rId}.json`;
            const histRes = await fetch(historyUrl);
            if (histRes.ok) {
                const historyData = await histRes.json();
                if (Array.isArray(historyData)) {
                    historyData.forEach(item => {
                        if (item.schedule_date && item.channel_id === rId) info.availableDates.add(item.schedule_date);
                    });
                }
            }
        } catch (e) { console.warn(`Історія для регіону ${rId} не знайдена.`); }
        return { todayDate: info.todayDate, availableDates: Array.from(info.availableDates).sort() };
    } catch (e) { return info; }
};

async function determineSourceForDate(date, regionId) {
    let todayDate = null;
    try {
        const res = await fetch(FILES.today);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) todayDate = data[0].schedule_date;
    } catch(e) {}
    if (todayDate && date === todayDate) return { type: 'today', url: FILES.today };
    if (todayDate && date > todayDate) return { type: 'tomorrow', url: FILES.tomorrow };
    return { type: 'history', url: `${FILES.historyBase}${regionId}.json` };
}

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
        timeline.push({ start: minutesToTime(currentCursor), end: "24:00", type: 'on' });
    }
    return { timeline, stats: { totalOffMinutes, percentage: Math.round((totalOffMinutes / 1440) * 100) } };
};

const timeToMinutes = (timeStr) => {
    if (timeStr === "24:00") return 1440;
    const [h, m] = timeStr.trim().split(':').map(Number);
    return h * 60 + m;
};

const minutesToTime = (minutes) => {
    if (minutes === 1440) return "24:00";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};
"use strict";
/**
 * Calendar intelligence — pulls today + tomorrow + the rest of the working
 * week from every visible (selected & not hidden) calendar, computes free
 * blocks, recurring patterns, and a small "upcoming important" list.
 *
 * Working window: 09:00–18:00 local. Free blocks shorter than 1h are dropped.
 * Heuristic only — no LLM.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyCalendarIntel = emptyCalendarIntel;
exports.fetchCalendarIntel = fetchCalendarIntel;
const LOG = "[agent/intel/calendar]";
function isoDate(d) {
    return d.toISOString().split("T")[0];
}
function emptyDay(date) {
    return {
        date,
        events: [],
        total_events: 0,
        total_busy_hours: 0,
        free_blocks: [],
        is_packed: false,
    };
}
function emptyCalendarIntel(status, error = null) {
    const today = isoDate(new Date());
    const tomorrow = isoDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    return {
        connected: status === "ok",
        status,
        error_message: error,
        today: emptyDay(today),
        tomorrow: emptyDay(tomorrow),
        this_week: { total_events: 0, busiest_day: null, quietest_day: null },
        upcoming_important: [],
        recurring_patterns: [],
    };
}
async function calGet(url, token) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok)
        return { ok: false, status: res.status, statusText: res.statusText };
    return { ok: true, body: (await res.json()) };
}
function dayBounds(d) {
    const s = new Date(d);
    s.setHours(0, 0, 0, 0);
    const e = new Date(d);
    e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
}
function workdayWindow(d) {
    const s = new Date(d);
    s.setHours(9, 0, 0, 0);
    const e = new Date(d);
    e.setHours(18, 0, 0, 0);
    return { start: s, end: e };
}
function buildDayAgenda(date, rawEvents) {
    const dStr = isoDate(date);
    const { start: workStart, end: workEnd } = workdayWindow(date);
    const { start: dayStart, end: dayEnd } = dayBounds(date);
    const events = rawEvents
        .filter((e) => {
        const startTs = e.start?.dateTime || e.start?.date;
        if (!startTs)
            return false;
        const s = new Date(startTs);
        return s >= dayStart && s <= dayEnd;
    })
        .map((e) => {
        const isAllDay = !!e.start?.date && !e.start?.dateTime;
        return {
            start: e.start?.dateTime || e.start?.date || "",
            end: e.end?.dateTime || e.end?.date || "",
            title: e.summary || "(sin título)",
            location: e.location || null,
            attendees: e.attendees?.length || 0,
            is_recurring: !!e.recurringEventId,
            is_all_day: isAllDay,
        };
    })
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    // Compute busy hours intersected with workday
    let busyMs = 0;
    const timedRanges = events
        .filter((e) => !e.is_all_day && e.start && e.end)
        .map((e) => ({ s: new Date(e.start), eEnd: new Date(e.end) }))
        .sort((a, b) => a.s.getTime() - b.s.getTime());
    // Merge overlapping ranges before intersecting
    const merged = [];
    for (const r of timedRanges) {
        if (merged.length === 0) {
            merged.push({ ...r });
            continue;
        }
        const last = merged[merged.length - 1];
        if (r.s <= last.eEnd) {
            if (r.eEnd > last.eEnd)
                last.eEnd = r.eEnd;
        }
        else {
            merged.push({ ...r });
        }
    }
    const free_blocks = [];
    let cursor = workStart;
    for (const r of merged) {
        const inStart = r.s < workStart ? workStart : r.s;
        const inEnd = r.eEnd > workEnd ? workEnd : r.eEnd;
        if (inEnd > inStart)
            busyMs += inEnd.getTime() - inStart.getTime();
        if (r.s > cursor && r.s <= workEnd) {
            const fStart = cursor;
            const fEnd = r.s > workEnd ? workEnd : r.s;
            const dh = (fEnd.getTime() - fStart.getTime()) / (60 * 60 * 1000);
            if (dh >= 1) {
                free_blocks.push({
                    start: fStart.toISOString(),
                    end: fEnd.toISOString(),
                    duration_hours: Number(dh.toFixed(1)),
                });
            }
        }
        if (r.eEnd > cursor)
            cursor = r.eEnd > workEnd ? workEnd : r.eEnd;
    }
    if (cursor < workEnd) {
        const dh = (workEnd.getTime() - cursor.getTime()) / (60 * 60 * 1000);
        if (dh >= 1) {
            free_blocks.push({
                start: cursor.toISOString(),
                end: workEnd.toISOString(),
                duration_hours: Number(dh.toFixed(1)),
            });
        }
    }
    const busyHours = Number((busyMs / (60 * 60 * 1000)).toFixed(1));
    return {
        date: dStr,
        events,
        total_events: events.length,
        total_busy_hours: busyHours,
        free_blocks,
        is_packed: busyHours > 6,
    };
}
function isImportant(ev) {
    const title = (ev.summary || "").toLowerCase();
    if (/\b(firma|contrato|renovaci[oó]n|cierre|vencimiento|plazo|deadline)\b/.test(title)) {
        return { important: true, why: `Posible firma/plazo: ${ev.summary}` };
    }
    if ((ev.attendees?.length || 0) >= 3) {
        return { important: true, why: `Reunión con ${ev.attendees.length} asistentes` };
    }
    if (/\b(inspecci[oó]n|auditor[ií]a|hacienda|seguridad social)\b/.test(title)) {
        return { important: true, why: `Trámite oficial: ${ev.summary}` };
    }
    return { important: false, why: "" };
}
async function fetchCalendarIntel(accessToken) {
    const t0 = Date.now();
    // 1) Discover calendars the user actually wants surfaced.
    const calList = await calGet("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader", accessToken);
    if (!calList.ok) {
        if (calList.status === 401 || calList.status === 403) {
            return emptyCalendarIntel("auth_expired", `Calendar list ${calList.status}`);
        }
        if (calList.status === 429)
            return emptyCalendarIntel("rate_limited", "Calendar 429");
        return emptyCalendarIntel("api_error", `Calendar list ${calList.status} ${calList.statusText}`);
    }
    const visible = (calList.body.items || []).filter((c) => !c.hidden && (c.selected || c.primary));
    if (visible.length === 0) {
        visible.push({ id: "primary", summary: "primary", primary: true });
    }
    // 2) Pull events for the next 14 days (covers today, tomorrow, and lookahead)
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const timeMin = new Date(now);
    timeMin.setHours(0, 0, 0, 0);
    const allEvents = [];
    for (const cal of visible) {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${timeMin.toISOString()}&timeMax=${horizon.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=250`;
        const r = await calGet(url, accessToken);
        if (!r.ok) {
            console.log(`${LOG} skip calendar ${cal.id}: ${r.status} ${r.statusText}`);
            continue;
        }
        allEvents.push(...(r.body.items || []));
    }
    const today = buildDayAgenda(now, allEvents);
    const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrow = buildDayAgenda(tomorrowDate, allEvents);
    // Week stats: from today through Sunday
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    const dow = weekStart.getDay(); // 0=Sun
    const daysUntilSunday = (7 - dow) % 7;
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + daysUntilSunday);
    weekEnd.setHours(23, 59, 59, 999);
    const perDayCount = new Map();
    for (const ev of allEvents) {
        const startTs = ev.start?.dateTime || ev.start?.date;
        if (!startTs)
            continue;
        const s = new Date(startTs);
        if (s < weekStart || s > weekEnd)
            continue;
        const k = isoDate(s);
        perDayCount.set(k, (perDayCount.get(k) || 0) + 1);
    }
    const dayEntries = Array.from(perDayCount.entries());
    const total_events = dayEntries.reduce((a, [, n]) => a + n, 0);
    let busiest_day = null;
    let quietest_day = null;
    if (dayEntries.length > 0) {
        dayEntries.sort((a, b) => b[1] - a[1]);
        busiest_day = { date: dayEntries[0][0], count: dayEntries[0][1] };
        quietest_day = { date: dayEntries[dayEntries.length - 1][0], count: dayEntries[dayEntries.length - 1][1] };
    }
    // Upcoming important (next 14 days, excluding today/tomorrow already covered fully)
    const upcoming_important = [];
    for (const ev of allEvents) {
        const startTs = ev.start?.dateTime || ev.start?.date;
        if (!startTs)
            continue;
        const s = new Date(startTs);
        if (s < now)
            continue;
        const { important, why } = isImportant(ev);
        if (!important)
            continue;
        const daysUntil = Math.max(0, Math.round((s.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
        upcoming_important.push({
            date: isoDate(s),
            title: ev.summary || "(sin título)",
            why_important: why,
            days_until: daysUntil,
        });
    }
    upcoming_important.sort((a, b) => a.days_until - b.days_until);
    // Recurring patterns: group recurring events by weekday + start hour
    const recurringBuckets = new Map();
    const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    for (const ev of allEvents) {
        if (!ev.recurringEventId)
            continue;
        const startTs = ev.start?.dateTime;
        if (!startTs)
            continue;
        const s = new Date(startTs);
        const key = `${s.getDay()}-${s.getHours()}-${ev.summary || ""}`;
        const desc = `${WEEKDAY[s.getDay()]} ${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")} ${ev.summary || ""}`.trim();
        const cur = recurringBuckets.get(key) || { description: desc, occurrences: 0 };
        cur.occurrences += 1;
        recurringBuckets.set(key, cur);
    }
    const recurring_patterns = Array.from(recurringBuckets.values())
        .filter((p) => p.occurrences >= 2)
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 6);
    console.log(`${LOG} calendars=${visible.length} events=${allEvents.length} today=${today.total_events} tomorrow=${tomorrow.total_events} upcoming_important=${upcoming_important.length} elapsed_ms=${Date.now() - t0}`);
    return {
        connected: true,
        status: "ok",
        error_message: null,
        today,
        tomorrow,
        this_week: { total_events, busiest_day, quietest_day },
        upcoming_important: upcoming_important.slice(0, 8),
        recurring_patterns,
    };
}

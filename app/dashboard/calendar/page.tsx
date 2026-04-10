/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

type Client = { id: string; name: string };
type Event = { id: string; title: string; description: string; event_date: string; event_time: string; duration_minutes: number; status: string; client_id: string; clients: { name: string } | null };

const daysOfWeek = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function CalendarPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", event_date: "", event_time: "10:00", duration_minutes: 30, client_id: "" });
  const supabase = createClient();

  const fetchClients = async () => {
    const { data } = await supabase.from("clients").select("id, name").order("name");
    if (data) setClients(data);
  };

  const fetchEvents = async () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const start = new Date(year, month, 1).toISOString().split("T")[0];
    const end = new Date(year, month + 1, 0).toISOString().split("T")[0];
    const { data } = await supabase.from("events").select("*, clients(name)").gte("event_date", start).lte("event_date", end).order("event_time");
    if (data) setEvents(data as Event[]);
  };

  useEffect(() => { fetchClients(); fetchEvents(); }, [currentDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("events").insert({ ...form, user_id: user?.id, client_id: form.client_id || null });
    setForm({ title: "", description: "", event_date: "", event_time: "10:00", duration_minutes: 30, client_id: "" });
    setShowForm(false);
    await fetchEvents();
  };

  const handleDelete = async (id: string) => {
    if (confirm("Eliminar esta cita?")) {
      await supabase.from("events").delete().eq("id", id);
      await fetchEvents();
    }
  };

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  const today = new Date().toISOString().split("T")[0];
  const getEventsForDate = (date: string) => events.filter(e => e.event_date === date);
  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];
  const statusColor = (s: string) => s === "scheduled" ? "bg-brand-green/10 text-brand-green" : s === "completed" ? "bg-navy-100 text-navy-500" : "bg-red-50 text-red-500";
  const statusLabel = (s: string) => s === "scheduled" ? "Programada" : s === "completed" ? "Completada" : "Cancelada";

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-navy-900">Calendario</h1>
          <p className="mt-1 text-navy-600">Gestiona tus citas y eventos</p>
        </div>
        <button onClick={() => { setShowForm(true); setForm({ ...form, event_date: selectedDate || today }); }} className="px-5 py-2.5 rounded-xl bg-brand-green text-white font-semibold shadow-lg shadow-brand-green/25 hover:bg-brand-green-dark transition-colors">+ Nueva cita</button>
      </div>
      {showForm && (
        <div className="mb-8 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-navy-900 mb-4">Nueva cita</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-navy-700 mb-1">Titulo *</label><input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Ej: Reunion con cliente" /></div>
            <div><label className="block text-sm font-medium text-navy-700 mb-1">Cliente (opcional)</label><select value={form.client_id} onChange={e => setForm({...form, client_id: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50"><option value="">Sin cliente</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-navy-700 mb-1">Fecha *</label><input type="date" value={form.event_date} onChange={e => setForm({...form, event_date: e.target.value})} required className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-navy-700 mb-1">Hora</label><input type="time" value={form.event_time} onChange={e => setForm({...form, event_time: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" /></div>
              <div><label className="block text-sm font-medium text-navy-700 mb-1">Duracion</label><select value={form.duration_minutes} onChange={e => setForm({...form, duration_minutes: Number(e.target.value)})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50"><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 hora</option><option value={90}>1.5 horas</option><option value={120}>2 horas</option></select></div>
            </div>
            <div className="md:col-span-2"><label className="block text-sm font-medium text-navy-700 mb-1">Descripcion</label><input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-navy-200 bg-navy-50 text-navy-900 focus:outline-none focus:ring-2 focus:ring-brand-green/50" placeholder="Notas sobre la cita" /></div>
            <div className="md:col-span-2 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2.5 rounded-xl border border-navy-200 text-sm font-medium text-navy-700 hover:bg-navy-50">Cancelar</button>
              <button type="submit" className="px-5 py-2.5 rounded-xl bg-brand-green text-white text-sm font-semibold hover:bg-brand-green-dark transition-colors">Guardar cita</button>
            </div>
          </form>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-navy-50 text-navy-700">◀</button>
              <h2 className="text-lg font-bold text-navy-900">{monthNames[month]} {year}</h2>
              <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-navy-50 text-navy-700">▶</button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {daysOfWeek.map(d => (<div key={d} className="text-center text-xs font-semibold text-navy-500 py-2">{d}</div>))}
              {Array.from({ length: offset }).map((_, i) => <div key={"e" + i} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const dayEvents = getEventsForDate(dateStr);
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                return (
                  <button key={day} onClick={() => setSelectedDate(dateStr)} className={`relative p-2 rounded-xl text-sm font-medium transition-colors ${isSelected ? "bg-brand-green text-white" : isToday ? "bg-brand-green/10 text-brand-green" : "text-navy-900 hover:bg-navy-50"}`}>
                    {day}
                    {dayEvents.length > 0 && <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-brand-green"}`} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-navy-100 bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-navy-100"><h2 className="font-bold text-navy-900">{selectedDate ? new Date(selectedDate + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) : "Selecciona un dia"}</h2></div>
            {!selectedDate ? (
              <div className="p-8 text-center"><p className="text-4xl mb-3">📅</p><p className="text-sm text-navy-600">Haz clic en un dia para ver sus citas</p></div>
            ) : selectedEvents.length === 0 ? (
              <div className="p-8 text-center"><p className="text-sm text-navy-600">Sin citas este dia</p></div>
            ) : (
              <div className="divide-y divide-navy-50">
                {selectedEvents.map(ev => (
                  <div key={ev.id} className="px-6 py-4">
                    <div className="flex items-center justify-between mb-1"><span className="text-sm font-semibold text-navy-900">{ev.title}</span><button onClick={() => handleDelete(ev.id)} className="text-xs text-red-500 hover:underline">Eliminar</button></div>
                    {ev.clients && <p className="text-xs text-brand-green font-medium">{ev.clients.name}</p>}
                    <p className="text-xs text-navy-500 mt-1">{ev.event_time?.slice(0, 5)} · {ev.duration_minutes} min</p>
                    {ev.description && <p className="text-xs text-navy-600 mt-1">{ev.description}</p>}
                    <span className={`inline-block mt-2 px-2 py-0.5 rounded-lg text-xs font-semibold ${statusColor(ev.status)}`}>{statusLabel(ev.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

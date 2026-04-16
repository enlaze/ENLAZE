/* eslint-disable react-hooks/set-state-in-effect */
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import PageHeader from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import Badge from "@/components/ui/badge";

type Client = { id: string; name: string };
type Event = { id: string; title: string; description: string; event_date: string; event_time: string; duration_minutes: number; status: string; client_id: string; clients: { name: string } | null };

const daysOfWeek = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
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
    if (confirm("¿Eliminar esta cita?")) {
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

  const statusBadge = (s: string) => {
    if (s === "scheduled") return <Badge variant="green">Programada</Badge>;
    if (s === "completed") return <Badge variant="gray">Completada</Badge>;
    return <Badge variant="red">Cancelada</Badge>;
  };

  return (
    <>
      <PageHeader
        title="Calendario"
        description="Gestiona tus citas y eventos"
        actions={
          <Button onClick={() => { setShowForm(true); setForm({ ...form, event_date: selectedDate || today }); }}>
            + Nueva cita
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-8">
          <h2 className="text-base font-semibold text-navy-900 dark:text-white mb-5">Nueva cita</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
            <FormField label="Título" required>
              <Input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required placeholder="Ej: Reunión con cliente" />
            </FormField>
            <FormField label="Cliente (opcional)">
              <Select value={form.client_id} onChange={e => setForm({...form, client_id: e.target.value})}>
                <option value="">Sin cliente</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Fecha" required>
              <Input type="date" value={form.event_date} onChange={e => setForm({...form, event_date: e.target.value})} required />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Hora">
                <Input type="time" value={form.event_time} onChange={e => setForm({...form, event_time: e.target.value})} />
              </FormField>
              <FormField label="Duración">
                <Select value={form.duration_minutes} onChange={e => setForm({...form, duration_minutes: Number(e.target.value)})}>
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>1 hora</option>
                  <option value={90}>1.5 horas</option>
                  <option value={120}>2 horas</option>
                </Select>
              </FormField>
            </div>
            <FormField label="Descripción" className="md:col-span-2">
              <Input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Notas sobre la cita" />
            </FormField>
            <div className="md:col-span-2 flex gap-3 justify-end pt-1">
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit">Guardar cita</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between mb-6">
              <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-navy-50 dark:hover:bg-zinc-800 text-navy-600 dark:text-zinc-400 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <h2 className="text-base font-semibold text-navy-900 dark:text-white">{monthNames[month]} {year}</h2>
              <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-navy-50 dark:hover:bg-zinc-800 text-navy-600 dark:text-zinc-400 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {daysOfWeek.map(d => (<div key={d} className="text-center text-[11px] font-semibold text-navy-500 dark:text-zinc-500 py-2">{d}</div>))}
              {Array.from({ length: offset }).map((_, i) => <div key={"e" + i} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const dayEvents = getEventsForDate(dateStr);
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                return (
                  <button key={day} onClick={() => setSelectedDate(dateStr)} className={`relative p-2 rounded-xl text-sm font-medium transition-colors ${isSelected ? "bg-brand-green text-white" : isToday ? "bg-brand-green/10 text-brand-green" : "text-navy-900 dark:text-white hover:bg-navy-50 dark:hover:bg-zinc-800"}`}>
                    {day}
                    {dayEvents.length > 0 && <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-white" : "bg-brand-green"}`} />}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card padding={false} className="overflow-hidden">
            <CardHeader title={selectedDate ? new Date(selectedDate + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) : "Selecciona un día"} />
            {!selectedDate ? (
              <div className="py-12 text-center">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-navy-300 dark:text-zinc-600 mb-3"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>
                <p className="text-sm text-navy-500 dark:text-zinc-400">Haz clic en un día para ver sus citas</p>
              </div>
            ) : selectedEvents.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-navy-500 dark:text-zinc-400">Sin citas este día</p>
              </div>
            ) : (
              <div className="divide-y divide-navy-50 dark:divide-zinc-800">
                {selectedEvents.map(ev => (
                  <div key={ev.id} className="px-6 py-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-navy-900 dark:text-white">{ev.title}</span>
                      <button onClick={() => handleDelete(ev.id)} className="text-xs text-red-600 hover:underline font-medium">Eliminar</button>
                    </div>
                    {ev.clients && <p className="text-xs text-brand-green font-medium">{ev.clients.name}</p>}
                    <p className="text-xs text-navy-500 dark:text-zinc-400 mt-1">{ev.event_time?.slice(0, 5)} · {ev.duration_minutes} min</p>
                    {ev.description && <p className="text-xs text-navy-600 dark:text-zinc-400 mt-1">{ev.description}</p>}
                    <div className="mt-2">{statusBadge(ev.status)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

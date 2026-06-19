import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { format, isToday, isTomorrow, isPast, startOfDay, addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { parseAppointmentWithAI } from "@/lib/appointments.functions";
import { importFromGmail } from "@/lib/gmail.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CalendarHeart, Sparkles, Plus, MapPin, Trash2, LogOut, Clock, Mail, Wand2, Settings } from "lucide-react";

type Appointment = {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  source: string;
};

export const Route = createFileRoute("/_authenticated/app")({
  component: AppPage,
});

function AppPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: appts, isLoading } = useQuery({
    queryKey: ["appointments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("appointments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      toast.success("Removed");
    },
  });

  const { upcoming, past } = useMemo(() => {
    const list = appts ?? [];
    const upcoming = list.filter((a) => !isPast(new Date(a.ends_at ?? a.starts_at)));
    const past = list.filter((a) => isPast(new Date(a.ends_at ?? a.starts_at))).reverse();
    return { upcoming, past };
  }, [appts]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div className="absolute inset-0 paper-grain opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-2xl px-5 py-8 md:py-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarHeart className="h-5 w-5 text-accent" />
            <span className="font-serif text-xl">Aperture</span>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
            <LogOut className="h-4 w-4 mr-1" /> Sign out
          </Button>
        </header>

        <div className="mt-10">
          <h1 className="font-serif text-4xl md:text-5xl text-foreground leading-tight">
            Your schedule, <span className="text-accent italic">distilled</span>.
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            {format(new Date(), "EEEE, MMMM d")}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <NewAppointmentDialog open={open} onOpenChange={setOpen} />
          <Button asChild variant="outline">
            <Link to="/planner"><Wand2 className="h-4 w-4 mr-1.5" /> AI planner</Link>
          </Button>
          <GmailImportButton />
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link to="/setup/gmail"><Settings className="h-3.5 w-3.5 mr-1" /> Gmail setup</Link>
          </Button>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Imports from the connected Gmail inbox. Only emails that clearly describe an appointment will be added.
        </p>

        <Tabs defaultValue="upcoming" className="mt-10">
          <TabsList className="bg-secondary">
            <TabsTrigger value="upcoming">Upcoming · {upcoming.length}</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="mt-6">
            {isLoading ? (
              <EmptyState label="Loading…" />
            ) : upcoming.length === 0 ? (
              <EmptyState label="Nothing on the horizon yet." hint="Add one with AI or manually." />
            ) : (
              <GroupedList items={upcoming} onDelete={(id) => del.mutate(id)} />
            )}
          </TabsContent>

          <TabsContent value="past" className="mt-6">
            {past.length === 0 ? (
              <EmptyState label="No past appointments." />
            ) : (
              <GroupedList items={past} onDelete={(id) => del.mutate(id)} muted />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function GmailImportButton() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const t = toast.loading("Scanning your inbox…");
    try {
      const res = await importFromGmail();
      toast.dismiss(t);
      if (res.imported > 0) {
        toast.success(`Imported ${res.imported} appointment${res.imported === 1 ? "" : "s"} from Gmail`);
        qc.invalidateQueries({ queryKey: ["appointments"] });
      } else {
        toast.message("No new appointments found", { description: `Scanned ${res.scanned} recent emails.` });
      }
    } catch (err) {
      toast.dismiss(t);
      toast.error(err instanceof Error ? err.message : "Couldn't import from Gmail");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" onClick={run} disabled={busy}>
      <Mail className="h-4 w-4 mr-1.5" />
      {busy ? "Scanning…" : "Import from Gmail"}
    </Button>
  );
}

function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
      <p className="font-serif text-lg text-foreground">{label}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

function GroupedList({ items, onDelete, muted }: { items: Appointment[]; onDelete: (id: string) => void; muted?: boolean }) {
  const groups = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of items) {
      const key = startOfDay(new Date(a.starts_at)).toISOString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="space-y-8">
      {groups.map(([key, list]) => {
        const d = new Date(key);
        const label = isToday(d) ? "Today" : isTomorrow(d) ? "Tomorrow" : format(d, "EEEE, MMM d");
        return (
          <div key={key}>
            <div className="mb-3 flex items-baseline gap-3">
              <h3 className="font-serif text-lg text-foreground">{label}</h3>
              <span className="text-xs text-muted-foreground">{format(d, "MMM d, yyyy")}</span>
            </div>
            <ul className={`space-y-3 ${muted ? "opacity-70" : ""}`}>
              {list.map((a) => (
                <AppointmentCard key={a.id} appt={a} onDelete={onDelete} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function AppointmentCard({ appt, onDelete }: { appt: Appointment; onDelete: (id: string) => void }) {
  const start = new Date(appt.starts_at);
  const end = appt.ends_at ? new Date(appt.ends_at) : null;
  return (
    <li className="group rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-accent/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-serif text-lg text-foreground truncate">{appt.title}</h4>
            {appt.source === "ai" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                <Sparkles className="h-2.5 w-2.5" /> AI
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {format(start, "h:mm a")}{end ? ` – ${format(end, "h:mm a")}` : ""}
            </span>
            {appt.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {appt.location}
              </span>
            )}
          </div>
          {appt.notes && <p className="mt-2 text-sm text-foreground/80">{appt.notes}</p>}
        </div>
        <button
          onClick={() => onDelete(appt.id)}
          className="text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          aria-label="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function NewAppointmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"ai" | "manual">("ai");

  // AI form
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // Manual form
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setAiText(""); setTitle(""); setDate(""); setTime(""); setEndTime(""); setLocation(""); setNotes("");
  }

  async function saveRaw(payload: {
    title: string; starts_at: string; ends_at: string | null;
    location: string | null; notes: string | null; source: "manual" | "ai";
  }) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw new Error("Not signed in");
    const { error } = await supabase.from("appointments").insert({ ...payload, user_id: userData.user.id });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["appointments"] });
    onOpenChange(false);
    reset();
    toast.success("Added to your schedule");
  }

  async function handleAi() {
    if (!aiText.trim()) return;
    setAiBusy(true);
    try {
      const parsed = await parseAppointmentWithAI({ data: { text: aiText, now: new Date().toISOString() } });
      await saveRaw({
        title: parsed.title,
        starts_at: parsed.starts_at,
        ends_at: parsed.ends_at,
        location: parsed.location,
        notes: parsed.notes,
        source: "ai",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't parse that");
    } finally {
      setAiBusy(false);
    }
  }

  async function handleManual(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !date || !time) {
      toast.error("Title, date, and time are required.");
      return;
    }
    const starts = new Date(`${date}T${time}`);
    const ends = endTime ? new Date(`${date}T${endTime}`) : null;
    try {
      await saveRaw({
        title: title.trim().slice(0, 200),
        starts_at: starts.toISOString(),
        ends_at: ends ? ends.toISOString() : null,
        location: location.trim() ? location.trim().slice(0, 200) : null,
        notes: notes.trim() ? notes.trim().slice(0, 1000) : null,
        source: "manual",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  }

  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-foreground text-background hover:bg-foreground/90">
          <Plus className="h-4 w-4 mr-1.5" /> New appointment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Add to your schedule</DialogTitle>
          <DialogDescription>Paste an email, describe it in words, or fill it in.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "ai" | "manual")}>
          <TabsList className="bg-secondary">
            <TabsTrigger value="ai"><Sparkles className="h-3.5 w-3.5 mr-1.5" /> With AI</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
          </TabsList>

          <TabsContent value="ai" className="mt-4 space-y-3">
            <Textarea
              placeholder={`e.g. "Dentist next Tuesday at 3pm, 220 Oak St"\nor paste a full email…`}
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              rows={7}
              maxLength={8000}
              className="resize-none"
            />
            <Button onClick={handleAi} disabled={aiBusy || !aiText.trim()} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              {aiBusy ? "Reading…" : (<><Sparkles className="h-4 w-4 mr-1.5" /> Extract & add</>)}
            </Button>
          </TabsContent>

          <TabsContent value="manual" className="mt-4">
            <form onSubmit={handleManual} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="t">Title</Label>
                <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lunch with Maya" maxLength={200} required />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1 space-y-1.5">
                  <Label htmlFor="d">Date</Label>
                  <Input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} placeholder={tomorrow} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s">Start</Label>
                  <Input id="s" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e">End</Label>
                  <Input id="e" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loc">Location</Label>
                <Input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n">Notes</Label>
                <Textarea id="n" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" rows={3} maxLength={1000} className="resize-none" />
              </div>
              <DialogFooter>
                <Button type="submit" className="w-full bg-foreground text-background hover:bg-foreground/90">Add appointment</Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

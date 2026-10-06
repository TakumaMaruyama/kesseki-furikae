import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { filterSelectableAbsenceSlots, getAutoSelectedAbsenceSlotId } from "@/lib/absence-slot-selection";
import { formatJstDate } from "@shared/jst";
import { directionLabels, type TransportDay, type TransportDirection, type TransportProfileView } from "@shared/transport";

type Slot = { id: string; date: string; startTime: string; courseLabel: string; isPastLesson?: boolean; lessonStartDateTime?: string };
const makeReceipt = () => "R-" + btoa(String.fromCharCode(...Array.from(crypto.getRandomValues(new Uint8Array(18))))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jstTime = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function NoticeFields({ direction, setDirection, note, setNote, disabled, profile }: {
  direction: TransportDirection; setDirection: (value: TransportDirection) => void;
  note: string; setNote: (value: string) => void; disabled: boolean; profile?: TransportProfileView;
}) {
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="mb-2 font-medium">利用しない便</legend>
    {(Object.keys(directionLabels) as TransportDirection[]).map(value => <label key={value} className="flex gap-3 rounded-md border p-3">
      <input type="radio" name="transport-direction" checked={direction === value} value={value}
        disabled={!!profile && ((value !== "INBOUND" && !profile.outbound) || (value !== "OUTBOUND" && !profile.inbound))}
        onChange={() => setDirection(value)} />
      <span>{directionLabels[value]}{value === "OUTBOUND" ? "（スクールへ向かう便）" : value === "INBOUND" ? "（スクールから帰る便）" : "（行き・帰りの両方）"}</span>
    </label>)}
    <Label htmlFor="transport-note">補足（任意・300文字まで）</Label>
    <Textarea id="transport-note" value={note} onChange={event => setNote(event.target.value)} maxLength={300} placeholder="例：帰りは保護者が迎えに行きます" />
  </fieldset>;
}

export default function TransportPage() {
  const [isNew, setIsNew] = useState(true), [childName, setChildName] = useState("");
  const [slotId, setSlotId] = useState(""), [selectedId, setSelectedId] = useState("");
  const [date, setDate] = useState(() => formatJstDate(new Date()));
  const [direction, setDirection] = useState<TransportDirection>("BOTH"), [note, setNote] = useState("");
  const [review, setReview] = useState(false), [message, setMessage] = useState("");
  const [code, setCode] = useState(""), [receipt, setReceipt] = useState(""), [draftReceipt, setDraftReceipt] = useState("");
  const session = useQuery<{ profiles: TransportProfileView[]; today: string }>({ queryKey: ["/api/transport/session"], retry: false });
  const profiles = session.data?.profiles || [];
  const profile = profiles.find(item => item.id === selectedId) || profiles[0];
  const today = session.data?.today || formatJstDate(new Date());
  const slots = useQuery<{ slots: Slot[] }>({ queryKey: ["/api/transport/lessons", date], enabled: isNew && /^\d{4}-\d{2}-\d{2}$/.test(date),
    queryFn: () => apiRequest("GET", "/api/transport/lessons?date=" + date), refetchInterval: 15_000, retry: false });
  const options = filterSelectableAbsenceSlots(slots.data?.slots || [], false);
  const selectedSlot = options.find(slot => slot.id === slotId);
  const dayKey = ["/api/transport/day", profile?.id, date];
  const day = useQuery<TransportDay>({ queryKey: dayKey, enabled: !isNew && !!profile && !!date, refetchInterval: 15_000, retry: false,
    queryFn: () => apiRequest("GET", "/api/transport/day?profileId=" + encodeURIComponent(profile!.id) + "&serviceDate=" + date) });
  const saved = day.data?.notice;
  useEffect(() => {
    try {
      const name = localStorage.getItem("hamasui_childName");
      if (name) setChildName(name);
    } catch { /* The form works when storage is unavailable. */ }
  }, []);
  useEffect(() => {
    if (isNew && !options.some(slot => slot.id === slotId)) setSlotId(getAutoSelectedAbsenceSlotId(options));
  }, [isNew, slots.data, slotId]);
  useEffect(() => {
    if (isNew) return;
    setReview(false);
    setDirection(saved?.direction || (profile?.outbound && profile?.inbound ? "BOTH" : profile?.outbound ? "OUTBOUND" : "INBOUND"));
    setNote(saved?.note || "");
  }, [isNew, profile?.id, date, saved?.version]);
  const openProfile = (id: string, available = profiles) => {
    setSelectedId(id); setIsNew(false); setReview(false); setMessage("");
    setDate(available.find(item => item.id === id)?.serviceDate || today);
  };
  const access = useMutation({ mutationFn: (value: string) => apiRequest("POST", "/api/transport/access", { code: value }),
    onSuccess: async (data, value) => { setReceipt(value); setCode(""); openProfile(data.selectedId, data.profiles); await session.refetch(); } });
  const submit = useMutation({ mutationFn: (receiptCode: string) => apiRequest("POST", "/api/transport/submissions",
    { childName, serviceDate: date, slotId, direction, note, receiptCode }),
    onSuccess: async data => {
      setReceipt(data.receiptCode); setDraftReceipt(""); setSelectedId(data.profile.id); setIsNew(false); setReview(false);
      await session.refetch(); await queryClient.invalidateQueries({ queryKey: ["/api/transport/day"] });
      setMessage("この日だけの送迎不要連絡を受け付けました。受付控えを保存してください。");
    } });
  const save = useMutation({ mutationFn: (status: "ACTIVE" | "CANCELLED") => apiRequest("POST", "/api/transport/notices", {
    profileId: profile!.id, serviceDate: date, direction: status === "CANCELLED" ? saved!.direction : direction,
    note: status === "CANCELLED" ? saved!.note : note, status, expectedVersion: saved?.version || 0 }),
    onSuccess: async (_data, status) => { setReview(false); await queryClient.invalidateQueries({ queryKey: dayKey });
      setMessage(status === "ACTIVE" ? "連絡を訂正しました。" : "送迎不要の連絡を取り消しました。出席予定は変わりません。"); },
    onError: () => { void day.refetch(); } });
  const busy = submit.isPending || access.isPending || save.isPending;
  const editable = !isNew && day.data?.eligible && day.data.editable && !day.isFetching;
  const startNew = () => {
    setIsNew(true); setReview(false); setMessage(""); setReceipt(""); setDraftReceipt(""); setSelectedId(""); setSlotId("");
    setDate(today); setDirection("BOTH"); setNote(""); submit.reset(); access.reset(); save.reset();
  };
  const error = submit.error || save.error || access.error || (isNew ? slots.error : day.error) || session.error;
  const reviewCard = <div className="rounded-lg border-2 border-primary p-4 space-y-3" data-testid="transport-review">
    <h2 className="font-bold">送信前の確認</h2>
    <p>{isNew ? childName : profile?.childName}さん · <strong>{date} のみ</strong></p>
    <p>{isNew ? selectedSlot?.startTime : day.data?.lessonTime} · {isNew ? selectedSlot?.courseLabel : day.data?.lessonLabel}</p>
    <p className="text-lg font-bold">{directionLabels[direction]}</p>
    <p>レッスンには出席します。他の日の送迎は変更しません。</p>
    {note && <p className="whitespace-pre-wrap break-words">補足：{note}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || (isNew ? !selectedSlot || slots.isFetching : !editable)} onClick={() => {
        if (isNew) { const value = draftReceipt || makeReceipt(); setDraftReceipt(value); submit.mutate(value); }
        else save.mutate("ACTIVE");
      }}>{busy ? "送信中…" : "この内容で送信"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setReview(false)}>入力に戻る</Button>
    </div>
  </div>;
  return <div className="min-h-screen bg-background">
    <header className="border-b"><div className="mx-auto max-w-2xl px-4 py-5"><h1 className="text-xl font-bold">その日だけの送迎不要連絡</h1></div></header>
    <main className="mx-auto max-w-2xl px-4 py-6 pb-28 space-y-5">
      <Link href="/" className="text-sm text-primary underline">欠席・振替の画面へ</Link>
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-1">
        <p className="font-semibold">レッスンには出席します。選んだ日だけ送迎を利用しません。</p>
        <p className="text-sm">欠席連絡と同じように、お名前とレッスンを入力してください。事前のコード発行は不要です。</p>
      </div>
      {isNew && <Card><CardHeader><CardTitle className="text-lg"><h2>送迎不要連絡を登録</h2></CardTitle></CardHeader><CardContent>
        <form className="space-y-5" onSubmit={event => { event.preventDefault(); setReview(true); submit.reset(); }}>
          <fieldset disabled={busy || review} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="transport-name">お子様の名前（ひらがなで入力）</Label>
              <Input id="transport-name" className="h-12" placeholder="例：やまだ たろう" pattern="[ぁ-ゖー 　]+" value={childName} onChange={event => setChildName(event.target.value)} maxLength={80} required /></div>
            <div className="space-y-2 min-w-0"><Label htmlFor="transport-date">送迎を利用しない日</Label>
              <Input id="transport-date" className="h-12 w-full min-w-0" type="date" value={date} required min={today} onChange={event => { setDate(event.target.value); setSlotId(""); }} /></div>
            <fieldset className="space-y-2"><legend className="font-medium mb-2">出席するレッスン枠</legend>
              {slots.isFetching && <p role="status">レッスン枠を読み込み中です…</p>}
              <div role="radiogroup" aria-label="出席するレッスン枠" className="grid gap-2">{options.map(slot => <button type="button" role="radio" key={slot.id}
                aria-checked={slot.id === slotId} aria-label={slot.startTime + " - " + slot.courseLabel}
                className={"rounded-md border p-3 text-left " + (slot.id === slotId ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-input")}
                onClick={() => setSlotId(slot.id)}><span className="block font-semibold">{slot.startTime}</span><span className="text-sm">{slot.courseLabel}</span></button>)}</div>
              {!slots.isFetching && options.length === 0 && <p className="text-sm text-destructive">この日には、開始前のレッスンがありません。</p>}
              {selectedSlot?.lessonStartDateTime && <p className="text-sm">入力・訂正・取消の締切：{jstTime(selectedSlot.lessonStartDateTime)}（レッスン開始）</p>}
            </fieldset>
          </fieldset>
          <NoticeFields direction={direction} setDirection={setDirection} note={note} setNote={setNote} disabled={busy || review} />
          {!review ? <Button className="w-full" type="submit" disabled={busy || !selectedSlot || slots.isFetching || !childName.trim()}>送信内容を確認</Button> : reviewCard}
        </form>
      </CardContent></Card>}
      {(receipt || (submit.isError && draftReceipt)) && <div className="rounded-lg border border-primary bg-primary/5 p-4 space-y-3" data-testid="transport-receipt">
        <h2 className="font-bold">本人用の受付控え</h2>
        <code className="block break-all select-all text-lg" data-testid="transport-receipt-code">{receipt || draftReceipt}</code>
        <Button variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(receipt || draftReceipt); setMessage("受付控えをコピーしました。"); }
          catch { setMessage("受付控えを選択してコピーし、保存してください。"); }
        }}>受付控えをコピー</Button>
        <p className="text-sm">確認・訂正・取消に使います。ご家庭で保存し、他の方には渡さないでください。メール配信はありません。</p>
        {submit.isError && draftReceipt && <Button variant="outline" disabled={busy} onClick={() => { submit.reset(); access.mutate(draftReceipt); }}>この控えで送信結果を確認</Button>}
      </div>}
      {!isNew && profile && <Card><CardHeader><CardTitle className="text-lg"><h2>{profile.childName}さんの連絡</h2></CardTitle></CardHeader><CardContent className="space-y-4">
        {profile.selfSubmitted ? <p className="font-medium">{date} のみ</p> : <div><Label htmlFor="transport-old-date">対象日（日本時間）</Label><Input id="transport-old-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></div>}
        {day.isFetching && <p role="status">連絡を確認中です…</p>}
        {day.data && <p className="text-sm" data-testid="transport-eligibility">{day.data.eligible ? "レッスン " + day.data.lessonTime + " " + (day.data.lessonLabel || "") + "・出席予定" : day.data.reason}</p>}
        {day.data?.deadlineAt && <p className="text-sm">入力・訂正・取消の締切：{jstTime(day.data.deadlineAt)}（レッスン開始）</p>}
        {day.data?.editingReason && <p role="status" className="text-destructive">{day.data.editingReason}</p>}
        {saved && <div className="rounded-lg border p-4 space-y-2" data-testid="transport-saved">
          <p className="font-semibold">{saved.serviceDate} のみ · {directionLabels[saved.direction]}</p>
          <p>{saved.status === "CANCELLED" ? "取消済み（送迎不要の連絡を取り消しました）" : "送迎不要の連絡を受付済み"}</p>
          <p>{saved.acknowledgedVersion === saved.version ? "スタッフ確認済み" : "スタッフ未確認"}</p>
          {saved.note && <p className="whitespace-pre-wrap break-words">補足：{saved.note}</p>}
          {saved.status === "ACTIVE" && <Button variant="outline" disabled={busy || !day.data?.editable} onClick={() => {
            if (window.confirm("この日の送迎不要連絡を取り消しますか？出席予定は変わりません。")) save.mutate("CANCELLED");
          }}>この日の連絡を取り消す</Button>}
        </div>}
        {editable && <form className="space-y-4" onSubmit={event => { event.preventDefault(); setReview(true); save.reset(); }}>
          <NoticeFields direction={direction} setDirection={setDirection} note={note} setNote={setNote} disabled={busy || review} profile={profile} />
          {!review ? <Button type="submit" className="w-full" disabled={busy}>{saved?.status === "ACTIVE" ? "訂正内容を確認" : "送信内容を確認"}</Button> : reviewCard}
        </form>}
        <p className="text-sm text-muted-foreground">名前・日付・レッスンを訂正する場合は、この連絡を取り消してから新しく入力してください。</p>
        <Button variant="outline" disabled={busy} onClick={startNew}>別のお子様・別の日の連絡を入力</Button>
      </CardContent></Card>}
      <details className="rounded-lg border p-4 space-y-4">
        <summary className="cursor-pointer font-semibold">送信済みの連絡を確認・訂正</summary>
        <form onSubmit={event => { event.preventDefault(); submit.reset(); access.mutate(code.trim()); }} className="space-y-3">
          <Label htmlFor="transport-receipt-input">本人用の受付控え</Label>
          <Input id="transport-receipt-input" type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} required maxLength={100} disabled={busy} />
          <Button type="submit" disabled={busy || !code.trim()}>連絡を表示</Button>
        </form>
        <p className="text-sm text-muted-foreground">送信後に自動表示された控えを入力してください。以前発行された送迎連絡コードも使えます。</p>
        {profiles.length > 0 && <div className="space-y-3">
          <Label htmlFor="transport-child">この端末で確認した連絡（最近5件）</Label>
          <select id="transport-child" className="w-full rounded-md border bg-background p-3" value={selectedId} disabled={busy} onChange={event => { setReceipt(""); openProfile(event.target.value); }}>
            <option value="">連絡を選択</option>{profiles.map(item => <option key={item.id} value={item.id}>{item.childName}{item.serviceDate ? " · " + item.serviceDate : ""}</option>)}
          </select>
          <Button variant="ghost" disabled={busy} onClick={async () => {
            await apiRequest("POST", "/api/transport/logout", {}); queryClient.removeQueries({ queryKey: ["/api/transport/day"] }); await session.refetch(); startNew();
          }}>連絡の表示を終了</Button>
        </div>}
      </details>
      <p className="text-sm text-muted-foreground">入力・訂正・取消はレッスン開始までです。締切後はスクールへご連絡ください。出席・欠席・振替の登録内容は変更しません。</p>
      {message && <p role="status" className="rounded-md bg-primary/10 p-4">{message}</p>}
      {error && <div role="alert" className="rounded-md border border-destructive p-4 text-destructive">{error.message}</div>}
    </main>
  </div>;
}

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatJstDate } from "@shared/jst";
import { directionLabels, type TransportDay, type TransportDirection, type TransportProfileView } from "@shared/transport";

export default function TransportPage() {
  const [code, setCode] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [date, setDate] = useState(() => formatJstDate(new Date()));
  const [direction, setDirection] = useState<TransportDirection>("BOTH");
  const [note, setNote] = useState("");
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");
  const session = useQuery<{ profiles: TransportProfileView[]; today: string }>({ queryKey: ["/api/transport/session"], retry: false });
  const profiles = session.data?.profiles || [];
  const profile = profiles.find((item) => item.id === selectedId) || profiles[0];
  const dayKey = ["/api/transport/day", profile?.id, date];
  const day = useQuery<TransportDay>({ queryKey: dayKey, enabled: !!profile && !!date, retry: false, refetchInterval: 15_000,
    queryFn: () => apiRequest("GET", `/api/transport/day?profileId=${encodeURIComponent(profile!.id)}&serviceDate=${date}`),
  });
  const saved = day.data?.notice;
  const today = session.data?.today || formatJstDate(new Date());
  useEffect(() => {
    setReview(false); setMessage("");
    setDirection(saved?.direction || (profile?.outbound && profile?.inbound ? "BOTH" : profile?.outbound ? "OUTBOUND" : "INBOUND"));
    setNote(saved?.note || "");
  }, [profile?.id, date, saved?.version]);
  const access = useMutation({
    mutationFn: () => apiRequest("POST", "/api/transport/access", { code }),
    onSuccess: async (data) => { setCode(""); setSelectedId(data.selectedId); await queryClient.invalidateQueries({ queryKey: ["/api/transport/session"] }); },
  });
  const save = useMutation({
    mutationFn: (status: "ACTIVE" | "CANCELLED") => apiRequest("POST", "/api/transport/notices", {
      profileId: profile!.id, serviceDate: date, direction: status === "CANCELLED" ? saved!.direction : direction,
      note: status === "CANCELLED" ? saved!.note : note, status, expectedVersion: saved?.version || 0,
    }),
    onSuccess: async (_data, status) => {
      setReview(false);
      await queryClient.invalidateQueries({ queryKey: dayKey });
      setMessage(status === "ACTIVE" ? "この日だけの送迎不要連絡を受け付けました。" : "送迎不要の連絡を取り消しました。出席予定は変わりません。");
    },
    onError: () => { void day.refetch(); },
  });
  const busy = access.isPending || save.isPending;
  const canSend = day.data?.eligible && day.data.editable && !day.isFetching && date >= today;
  const error = save.error || access.error || day.error || session.error;
  return <div className="min-h-screen bg-background">
    <header className="border-b"><div className="mx-auto max-w-2xl px-4 py-5"><h1 className="text-xl font-bold">その日だけの送迎不要連絡</h1></div></header>
    <main className="mx-auto max-w-2xl px-4 py-6 pb-28 space-y-5">
      <Link href="/" className="text-sm text-primary underline">欠席・振替の画面へ</Link>
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-1">
        <p className="font-semibold">レッスンには出席します。選んだ日だけ送迎を利用しません。</p>
        <p className="text-sm">欠席届や、今後ずっと送迎を止める手続きではありません。行き・帰りをお確かめください。</p>
      </div>
      <Card><CardHeader><CardTitle className="text-lg"><h2>お子様を確認</h2></CardTitle></CardHeader><CardContent className="space-y-4">
        <form onSubmit={(event) => { event.preventDefault(); access.mutate(); }} className="space-y-2">
          <Label htmlFor="transport-code">スクールから案内された送迎連絡コード</Label>
          <Input id="transport-code" type="password" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} required maxLength={100} disabled={busy} />
          <Button type="submit" disabled={busy || !code.trim()}>{profiles.length ? "別のお子様を追加" : "お子様を表示"}</Button>
        </form>
        <p className="text-sm text-muted-foreground">欠席の確認コードとは別です。コードがない場合はスクールへお問い合わせください。</p>
        {profiles.length > 0 && <div className="space-y-2">
          <Label htmlFor="transport-child">連絡するお子様</Label>
          <select id="transport-child" className="w-full rounded-md border bg-background p-3" value={profile?.id} disabled={busy} onChange={(event) => setSelectedId(event.target.value)}>
            {profiles.map((item) => <option value={item.id} key={item.id}>{item.childName}（{item.classBand}）</option>)}
          </select>
          <Button variant="ghost" disabled={busy} onClick={async () => { await apiRequest("POST", "/api/transport/logout", {}); queryClient.removeQueries({ queryKey: ["/api/transport/day"] }); await session.refetch(); }}>お子様の表示を終了</Button>
        </div>}
      </CardContent></Card>
      {profile && <Card><CardHeader><CardTitle className="text-lg"><h2>{profile.childName}さんの連絡</h2></CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor="transport-date">送迎を利用しない日（日本時間）</Label>
          <Input id="transport-date" type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
        </div>
        {day.isFetching && <p role="status">この日の予定を確認中です…</p>}
        {day.data && <p className="text-sm" data-testid="transport-eligibility">{day.data.eligible ? `通常レッスン ${day.data.lessonTime}・出席予定` : day.data.reason}</p>}
        {day.data?.deadlineAt && <p className="text-sm">入力・訂正・取消の締切：{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(day.data.deadlineAt))}（レッスン開始・日本時間）</p>}
        {day.data?.editingReason && <p role="status" className="text-sm text-destructive">{day.data.editingReason}</p>}
        {date < today && <p className="text-sm text-destructive">過去の日付は確認のみできます。</p>}
        {saved && <div className="rounded-lg border p-4 space-y-2" data-testid="transport-saved">
          <p className="font-semibold">{saved.serviceDate} のみ · {directionLabels[saved.direction]}</p>
          <p>{saved.status === "CANCELLED" ? "取消済み（送迎不要の連絡を取り消しました）" : "送迎不要の連絡を受付済み"}</p>
          <p className="text-sm">{saved.acknowledgedVersion === saved.version ? "スタッフ確認済み" : "スタッフ未確認"}</p>
          {saved.note && <p className="whitespace-pre-wrap break-words text-sm">補足：{saved.note}</p>}
          {saved.status === "ACTIVE" && <Button variant="outline" disabled={busy || !day.data?.editable || date < today} onClick={() => {
            if (window.confirm(`${date}の「${directionLabels[saved.direction]}」を取り消しますか？出席予定は変わりません。`)) save.mutate("CANCELLED");
          }}>この日の連絡を取り消す</Button>}
        </div>}
        {canSend && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setReview(true); save.reset(); }}>
          <fieldset disabled={busy || review} className="space-y-3">
            <legend className="mb-2 font-medium">利用しない便</legend>
            {(Object.keys(directionLabels) as TransportDirection[]).map((value) => <label key={value} className="flex gap-3 rounded-md border p-3">
              <input type="radio" name="transport-direction" value={value} checked={direction === value}
                disabled={(value !== "INBOUND" && !profile.outbound) || (value !== "OUTBOUND" && !profile.inbound)} onChange={() => setDirection(value)} />
              <span>{directionLabels[value]}{value === "OUTBOUND" ? "（スクールへ向かう便）" : value === "INBOUND" ? "（スクールから帰る便）" : "（行き・帰りの両方）"}</span>
            </label>)}
            <Label htmlFor="transport-note">補足（任意・300文字まで）</Label>
            <Textarea id="transport-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="例：帰りは保護者が迎えに行きます" />
          </fieldset>
          {!review && <Button type="submit" disabled={busy} className="w-full">{saved?.status === "ACTIVE" ? "訂正内容を確認" : "送信内容を確認"}</Button>}
          {review && <div className="rounded-lg border-2 border-primary p-4 space-y-3" data-testid="transport-review">
            <h2 className="font-bold">送信前の確認</h2>
            <p>{profile.childName}さん · <strong>{date} のみ</strong></p>
            <p className="text-lg font-bold">{directionLabels[direction]}</p>
            <p className="text-sm">レッスンには出席します。他の日の送迎は変更しません。</p>
            {note && <p className="whitespace-pre-wrap break-words">補足：{note}</p>}
            <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => save.mutate("ACTIVE")}>{busy ? "送信中…" : "この内容で送信"}</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setReview(false)}>入力に戻る</Button></div>
          </div>}
        </form>}
        <p className="text-sm text-muted-foreground">日付を訂正する場合は、元の日付の連絡を取り消してから、正しい日付で送信してください。入力・訂正・取消はレッスン開始までです。送信後はスタッフの確認状況もお確かめください。</p>
      </CardContent></Card>}
      {message && <p role="status" className="rounded-md bg-primary/10 p-4">{message}</p>}
      {error && <div role="alert" className="rounded-md border border-destructive p-4 text-destructive space-y-2"><p>{error.message}</p>
        <Button variant="outline" onClick={async () => { save.reset(); access.reset(); await session.refetch(); await day.refetch(); }}>最新の連絡を読み込む</Button></div>}
    </main>
  </div>;
}

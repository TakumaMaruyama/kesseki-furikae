import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatJstDate } from "@shared/jst";
import type { Course } from "@shared/schema";
import { directionLabels, type StaffTransportNotice, type TransportProfileView } from "@shared/transport";

export default function TransportPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [date, setDate] = useState(() => formatJstDate(new Date()));
  const [childName, setChildName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [classBand, setClassBand] = useState("初級");
  const [outbound, setOutbound] = useState(false), [inbound, setInbound] = useState(false);
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);
  const noticesEndpoint = readOnly ? "/api/staff/transport/notices" : "/api/admin/transport/notices";
  const notices = useQuery<StaffTransportNotice[]>({ queryKey: [noticesEndpoint, date],
    queryFn: () => apiRequest("GET", `${noticesEndpoint}?date=${date}`), enabled: !!date, refetchInterval: 30_000, retry: false });
  const profiles = useQuery<TransportProfileView[]>({ queryKey: ["/api/admin/transport/profiles"], retry: false, enabled: !readOnly });
  const courses = useQuery<Course[]>({ queryKey: ["/api/admin/courses"], enabled: !readOnly });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/transport/notices"] });
  const acknowledge = useMutation({ mutationFn: (notice: StaffTransportNotice) => apiRequest("POST", `/api/admin/transport/notices/${notice.id}/acknowledge`, { version: notice.version }), onSuccess: refresh });
  const create = useMutation({ mutationFn: () => apiRequest("POST", "/api/admin/transport/profiles", { childName, courseId, classBand, outbound, inbound }),
    onSuccess: async (data) => { setIssued({ name: data.profile.childName, code: data.code }); setChildName(""); await profiles.refetch(); } });
  const rotate = useMutation({ mutationFn: (id: string) => apiRequest("POST", `/api/admin/transport/profiles/${id}/rotate-code`, {}),
    onSuccess: async (data) => { setIssued({ name: data.profile.childName, code: data.code }); await profiles.refetch(); } });
  const stop = useMutation({ mutationFn: (id: string) => apiRequest("POST", `/api/admin/transport/profiles/${id}/stop`, {}),
    onSuccess: async () => { setIssued(null); await profiles.refetch(); await refresh(); } });
  const errors = [notices.error, ...(!readOnly ? [profiles.error, courses.error, acknowledge.error, create.error, rotate.error, stop.error] : [])].filter(Boolean);
  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>その日だけの送迎不要連絡</CardTitle><p className="text-sm text-muted-foreground">出席・振替・定員は変更しません。訂正・取消後は、もう一度内容を確認してください。</p></CardHeader>
      <CardContent className="space-y-4">
        <a href="/transport" className="inline-block text-sm text-primary underline">保護者の送迎連絡画面を開く</a>
        <div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="staff-transport-date">対象日（日本時間）</Label><Input id="staff-transport-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
          <Button variant="outline" onClick={() => notices.refetch()}>送迎連絡を更新</Button>
          <Badge variant="secondary">未確認 {(notices.data || []).filter((item) => item.acknowledgedVersion !== item.version).length}件</Badge></div>
        <p className="text-sm">選択日の連絡のみ表示しています（30秒ごとに更新）。「帰り不要」でも行きは利用します。</p>
        {notices.isLoading && <p role="status">読み込み中…</p>}
        {notices.data?.length === 0 && <p>この日の連絡はありません。</p>}
        {(notices.data || []).map((item) => <article key={item.id} className="rounded-lg border p-4 space-y-2" data-testid={`staff-transport-${item.profileId}`}>
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{item.childName} · {item.classBand}</h3><Badge variant={item.status === "CANCELLED" ? "outline" : "default"}>{item.status === "CANCELLED" ? "取消済み" : directionLabels[item.direction]}</Badge></div>
          <p>{item.serviceDate} のみ {item.lessonTime && `· レッスン ${item.lessonTime}`}</p>
          <p className="text-sm">{item.status === "CANCELLED" ? `${directionLabels[item.direction]}の連絡を取り消しました。通常の送迎予定を確認してください。` : "レッスンには出席予定です。"}</p>
          {item.attendanceWarning && <p className="text-destructive font-semibold" role="alert">出席予定の再確認が必要：{item.attendanceWarning}</p>}
          {item.note && <p className="whitespace-pre-wrap break-words">補足：{item.note}</p>}
          <p className="text-xs text-muted-foreground">更新：{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(item.updatedAt))}（日本時間）</p>
          {item.acknowledgedVersion === item.version ? <p className="text-sm font-semibold">スタッフ確認済み</p> : readOnly ? <p className="text-sm font-semibold">スタッフ未確認（管理者が確認を記録します）</p> : <Button disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(item)}>この内容を確認済みにする</Button>}
        </article>)}
      </CardContent>
    </Card>
    {!readOnly && <details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">送迎対象の登録・連絡コード</summary>
      <p className="my-3 text-sm">送迎名簿を確認して登録してください。保護者が対象児童を確認するための専用コードを発行します。欠席の確認コードとは別です。</p>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <div><Label htmlFor="transport-roster-name">お子様の名前（ひらがな）</Label><Input id="transport-roster-name" value={childName} onChange={(event) => setChildName(event.target.value)} required maxLength={80} /></div>
        <div><Label htmlFor="transport-roster-grade">クラス</Label><select id="transport-roster-grade" className="w-full rounded-md border bg-background p-2" value={classBand} onChange={(event) => setClassBand(event.target.value)}>{["初級", "中級", "上級"].map((band) => <option key={band}>{band}</option>)}</select></div>
        <div><Label htmlFor="transport-roster-course">通常コース</Label><select id="transport-roster-course" className="w-full rounded-md border bg-background p-2" value={courseId} onChange={(event) => setCourseId(event.target.value)} required><option value="">選択してください</option>{courses.data?.filter((course) => course.isActive).map((course) => <option key={course.id} value={course.id}>{course.name}（{course.dayOfWeek} {course.startTime}）</option>)}</select></div>
        <fieldset className="space-y-2"><legend>普段利用する便（名簿確認済み）</legend><label className="flex gap-2"><input type="checkbox" checked={outbound} onChange={(event) => setOutbound(event.target.checked)} />行き</label><label className="flex gap-2"><input type="checkbox" checked={inbound} onChange={(event) => setInbound(event.target.checked)} />帰り</label></fieldset>
        <Button disabled={create.isPending || (!outbound && !inbound)} type="submit">対象児童を登録してコードを発行</Button>
      </form>
      {issued && <div role="status" className="my-4 rounded-md bg-primary/10 p-4 space-y-2"><p>{issued.name}さんの送迎連絡コード</p><code className="break-all select-all" data-testid="transport-issued-code">{issued.code}</code><p className="text-sm">この画面で控えて、該当の保護者だけに案内してください。再表示はできません。</p></div>}
      <div className="mt-4 space-y-2">{profiles.data?.map((profile) => <div className="flex flex-wrap justify-between gap-2 border-t pt-3" key={profile.id} data-testid={`transport-roster-${profile.id}`}><p>{profile.childName} · {profile.classBand} · {profile.outbound && profile.inbound ? "往復利用" : profile.outbound ? "行き利用" : "帰り利用"} · {profile.active ? "利用中" : "停止中"}</p><Button size="sm" variant="outline" disabled={rotate.isPending || stop.isPending} onClick={() => {
        if (window.confirm(`${profile.childName}さんのコードを再発行します。古いコードと保護者の表示権限は無効になります。`)) rotate.mutate(profile.id);
      }}>{profile.active ? "コードを再発行" : "再開してコードを発行"}</Button>
        {profile.active && <Button size="sm" variant="outline" disabled={stop.isPending || rotate.isPending} onClick={() => {
          if (window.confirm(`${profile.childName}さんのコードを停止します（退会・利用停止）。保護者の表示・入力権限は無効になります。既存の連絡は削除せず再確認が必要になります。`)) stop.mutate(profile.id);
        }}>コードを停止（退会・利用停止）</Button>}</div>)}</div>
    </details>}
    {errors.map((error, index) => <p key={index} role="alert" className="text-destructive">{error!.message}</p>)}
  </div>;
}

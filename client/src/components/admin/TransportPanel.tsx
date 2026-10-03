import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatJstDate } from "@shared/jst";
import { directionLabels, type StaffTransportNotice } from "@shared/transport";

export default function TransportPanel({ readOnly = false }: { readOnly?: boolean }) {
  const [date, setDate] = useState(() => formatJstDate(new Date()));
  const noticesEndpoint = readOnly ? "/api/staff/transport/notices" : "/api/admin/transport/notices";
  const notices = useQuery<StaffTransportNotice[]>({ queryKey: [noticesEndpoint, date],
    queryFn: () => apiRequest("GET", `${noticesEndpoint}?date=${date}`), enabled: !!date, refetchInterval: 30_000, retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/transport/notices"] });
  const acknowledge = useMutation({ mutationFn: (notice: StaffTransportNotice) => apiRequest("POST", `/api/admin/transport/notices/${notice.id}/acknowledge`, { version: notice.version }), onSuccess: refresh });
  const errors = [notices.error, ...(!readOnly ? [acknowledge.error] : [])].filter(Boolean);
  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>その日だけの送迎不要連絡</CardTitle><p className="text-sm text-muted-foreground">保護者がお名前とレッスンを入力して連絡します。スクールでのコード発行は不要です。訂正・取消後は、もう一度内容を確認してください。</p></CardHeader>
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
          <p className="text-sm">{item.selfSubmitted && "保護者入力 · "}{item.status === "CANCELLED" ? `${directionLabels[item.direction]}の連絡を取り消しました。通常の送迎予定を確認してください。` : "レッスンには出席予定です。"}</p>
          {item.attendanceWarning && <p className="text-destructive font-semibold" role="alert">出席予定の再確認が必要：{item.attendanceWarning}</p>}
          {item.note && <p className="whitespace-pre-wrap break-words">補足：{item.note}</p>}
          <p className="text-xs text-muted-foreground">更新：{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(item.updatedAt))}（日本時間）</p>
          {item.acknowledgedVersion === item.version ? <p className="text-sm font-semibold">スタッフ確認済み</p> : readOnly ? <p className="text-sm font-semibold">スタッフ未確認（管理者が確認を記録します）</p> : <Button disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(item)}>この内容を確認済みにする</Button>}
        </article>)}
      </CardContent>
    </Card>
    {errors.map((error, index) => <p key={index} role="alert" className="text-destructive">{error!.message}</p>)}
  </div>;
}

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { directionLabels, type StaffTransportNotice } from "@shared/transport";

export default function TransportPanel({ readOnly = false, selectedDate }: { readOnly?: boolean; selectedDate: string }) {
  const noticesEndpoint = readOnly ? "/api/staff/transport/notices" : "/api/admin/transport/notices";
  const notices = useQuery<StaffTransportNotice[]>({ queryKey: [noticesEndpoint, selectedDate],
    queryFn: () => apiRequest("GET", `${noticesEndpoint}?date=${selectedDate}`), enabled: !!selectedDate,
    staleTime: 0, refetchOnMount: "always", refetchInterval: 30_000, retry: false });
  return <Card className="border-amber-300/70">
    <CardHeader className="pb-3 flex-row items-center justify-between gap-2 space-y-0">
      <CardTitle className="text-base text-amber-800">送迎不要</CardTitle>
      <Button size="sm" variant="outline" aria-label="送迎連絡を更新" onClick={() => notices.refetch()}>更新</Button>
    </CardHeader>
    <CardContent>
      {notices.isLoading && <p role="status" className="text-sm text-muted-foreground">読み込み中…</p>}
      {notices.isError && <p role="alert" className="text-sm text-destructive">送迎連絡を読み込めませんでした。{notices.data?.length ? "表示は前回取得時の内容です。" : ""}「更新」で再試行してください。</p>}
      {!notices.isError && notices.data?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">この日の連絡はありません。</p>}
      <div className="space-y-2">
        {(notices.data || []).map((item) => {
          // Keep actual attendance/duplicate warnings; omit the notice common to every self-submission.
          const warning = item.attendanceWarning?.replace("保護者入力の連絡です。送迎名簿・出席予定を確認してください。", "").trim();
          const cancelled = item.status === "CANCELLED";
          return <article key={item.id} className={`rounded-lg border p-3 space-y-1 ${cancelled ? "bg-muted/40" : "bg-amber-50/60"}`} data-testid={`staff-transport-${item.profileId}`}>
            <div className="flex flex-wrap justify-between items-start gap-2">
              <h3 className="font-semibold break-words min-w-0">{item.childName}</h3>
              <Badge variant={cancelled ? "outline" : "secondary"}>{cancelled ? `取消済み（${directionLabels[item.direction]}）` : directionLabels[item.direction]}</Badge>
            </div>
            <p className="text-sm text-muted-foreground break-words">{item.lessonTime} {item.lessonLabel}</p>
            {warning && <p className="text-sm text-destructive font-semibold break-words" role="alert">{warning}</p>}
            {item.note && <p className="text-sm whitespace-pre-wrap break-words">{item.note}</p>}
          </article>;
        })}
      </div>
    </CardContent>
  </Card>;
}

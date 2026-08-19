import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useLocation } from "wouter";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, LogOutIcon, UserCheckIcon, UserPlusIcon, UserXIcon } from "lucide-react";
import { AdminLoginForm } from "@/components/admin";
import type { StaffRole } from "@/components/admin/types";
import { apiRequest } from "@/lib/queryClient";

type CoachDailyAbsentee = {
  childName: string;
  classBand: string;
  startTime: string;
  reportType: "ABSENCE" | "LATE";
};

type CoachDailyMakeup = {
  childName: string;
  classBand: string;
  startTime: string;
};

type CoachDailyTrialParticipant = {
  participantName: string;
  grade: string;
  swimLevel: string;
  classBand: string;
  startTime: string;
};

type CoachDailyStatus = {
  date: string;
  absentees: CoachDailyAbsentee[];
  makeups: CoachDailyMakeup[];
  trialParticipants: CoachDailyTrialParticipant[];
};

type CoachStatusItem = {
  name: string;
  classBand: string;
  startTime: string;
  detail?: string;
  badge?: string;
  badgeClassName?: string;
};

type StatusSectionColors = {
  cardClassName: string;
  timeClassName: string;
  itemClassName: string;
};

function getReportTypeBadgeStyle(reportType: "ABSENCE" | "LATE"): string {
  return reportType === "LATE"
    ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-red-100 text-red-700 border-red-200";
}

function groupByStartTime(items: CoachStatusItem[]): Array<{ startTime: string; items: CoachStatusItem[] }> {
  const grouped = new Map<string, CoachStatusItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.startTime) ?? [];
    existing.push(item);
    grouped.set(item.startTime, existing);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startTime, groupedItems]) => ({ startTime, items: groupedItems }));
}

function StatusSection({
  title,
  emptyMessage,
  items,
  icon,
  accentClassName,
  colors,
}: {
  title: string;
  emptyMessage: string;
  items: CoachStatusItem[];
  icon: React.ReactNode;
  accentClassName: string;
  colors: StatusSectionColors;
}) {
  const groups = useMemo(() => groupByStartTime(items), [items]);

  return (
    <Card className={`border-2 ${colors.cardClassName}`}>
      <CardHeader className="p-6 pb-4">
        <CardTitle className={`flex items-center gap-2 text-lg ${accentClassName}`}>
          {icon}
          {title}（{items.length}名）
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-0">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.startTime} className="space-y-2">
                <div className="overflow-hidden rounded-lg border-2">
                  <div className={`border-b px-3 py-2 ${colors.timeClassName}`}>
                    <p className="text-sm font-semibold">{group.startTime}</p>
                  </div>
                  <div className="divide-y">
                    {group.items.map((item, index) => (
                      <div
                        key={`${group.startTime}-${item.name}-${index}`}
                        className={`flex items-center justify-between gap-3 p-3 ${colors.itemClassName}`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{item.name}</p>
                          {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline">{item.classBand}</Badge>
                          {item.badge && (
                            <span
                              className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${
                                item.badgeClassName ?? "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CoachPage() {
  const [, setLocation] = useLocation();
  const [authState, setAuthState] = useState<"loading" | "unauthenticated" | "authenticated">("loading");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const dateString = format(selectedDate, "yyyy-MM-dd");

  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch("/api/staff/check", { credentials: "include" });
        const data = await response.json();
        if (data.authenticated && data.role === "admin") {
          setLocation("/admin");
          return;
        }
        setAuthState(data.authenticated && data.role === "coach" ? "authenticated" : "unauthenticated");
      } catch {
        setAuthState("unauthenticated");
      }
    }
    checkAuth();
  }, [setLocation]);

  const { data, isLoading, isError } = useQuery<CoachDailyStatus>({
    queryKey: ["/api/coach/daily-status", dateString],
    enabled: authState === "authenticated",
    queryFn: () => apiRequest("GET", `/api/coach/daily-status?date=${dateString}`),
  });

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/staff/logout", {});
    } finally {
      setAuthState("unauthenticated");
    }
  };

  if (authState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">認証状態を確認中...</p>
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <AdminLoginForm
        onSuccess={(role: StaffRole) => {
          if (role === "admin") {
            setLocation("/admin");
            return;
          }
          setAuthState("authenticated");
        }}
      />
    );
  }

  const absenceItems: CoachStatusItem[] = (data?.absentees ?? []).map((item) => ({
    name: item.childName,
    classBand: item.classBand,
    startTime: item.startTime,
    badge: item.reportType === "LATE" ? "遅刻" : "欠席",
    badgeClassName: getReportTypeBadgeStyle(item.reportType),
  }));
  const makeupItems: CoachStatusItem[] = (data?.makeups ?? []).map((item) => ({
    name: item.childName,
    classBand: item.classBand,
    startTime: item.startTime,
  }));
  const trialItems: CoachStatusItem[] = (data?.trialParticipants ?? []).map((item) => ({
    name: item.participantName,
    classBand: item.classBand,
    startTime: item.startTime,
    detail: [item.grade, item.swimLevel].filter(Boolean).join(" / "),
  }));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-6">
          <div>
            <h1 className="text-xl font-bold">はまスイ コーチ画面</h1>
            <p className="text-xs text-muted-foreground">日別状況（参照専用）</p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-coach-logout">
            <LogOutIcon className="mr-2 h-4 w-4" />
            ログアウト
          </Button>
        </div>
      </header>

      <main className="container space-y-6 px-4 py-8 md:py-12">
        <Card className="border-2">
          <CardHeader className="p-6 pb-4">
            <CardTitle className="text-xl">
              {format(selectedDate, "yyyy年M月d日(E)", { locale: ja })}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              className="rounded-md border"
              locale={ja}
            />
          </CardContent>
        </Card>

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {isError && (
          <Card className="border-2 border-destructive">
            <CardContent className="p-6 text-center text-destructive">
              日別状況を取得できませんでした。ページを再読み込みしてください。
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && data && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <StatusSection
              title="欠席・遅刻者"
              emptyMessage="欠席・遅刻者はいません"
              items={absenceItems}
              icon={<UserXIcon className="h-5 w-5" />}
              accentClassName="text-destructive"
              colors={{
                cardClassName: "border-destructive/30",
                timeClassName: "bg-destructive/10",
                itemClassName: "bg-destructive/5",
              }}
            />
            <StatusSection
              title="振替者"
              emptyMessage="振替者はいません"
              items={makeupItems}
              icon={<UserCheckIcon className="h-5 w-5" />}
              accentClassName="text-primary"
              colors={{
                cardClassName: "border-primary/30",
                timeClassName: "bg-primary/10",
                itemClassName: "bg-primary/5",
              }}
            />
            <StatusSection
              title="体験者"
              emptyMessage="体験者はいません"
              items={trialItems}
              icon={<UserPlusIcon className="h-5 w-5" />}
              accentClassName="text-emerald-700"
              colors={{
                cardClassName: "border-emerald-300/70",
                timeClassName: "bg-emerald-100/60",
                itemClassName: "bg-emerald-50/60",
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

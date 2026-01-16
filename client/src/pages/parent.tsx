import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { searchSlotsRequestSchema, createAbsenceRequestSchema, type SearchSlotsRequest, type SlotSearchResult, type CreateAbsenceRequest } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import {
  CalendarIcon, UserIcon, CheckCircleIcon, AlertTriangleIcon, ClockIcon,
  ListIcon, InfoIcon, XCircleIcon, ChevronDownIcon, CopyIcon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type AbsenceData = {
  id: string;
  childName: string;
  declaredClassBand: string;
  absentDate: string;
  originalSlotId?: string;
  contactEmail: string | null;
  makeupDeadline: string;
  makeupStatus: string;
  resumeToken?: string;
  confirmCode?: string;
};

// Helper to safely parse date string to local Date object avoiding timezone shifts
const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  // If it's already a Date object, return it
  if (dateStr instanceof Date) return dateStr;
  
  // Handle ISO string or date only string
  const datePart = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const [year, month, day] = datePart.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export default function ParentPage() {
  const token = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("token");
  }, []);

  const [absenceData, setAbsenceData] = useState<AbsenceData | null>(null);
  const [searchParams2, setSearchParams2] = useState<SearchSlotsRequest & { absenceId?: string } | null>(null);
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"list" | "calendar">(() => {
    return (localStorage.getItem("hamasui_viewMode") as "list" | "calendar") || "calendar";
  });
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [showConfirmCodeDialog, setShowConfirmCodeDialog] = useState(false);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const [availableSlotsForAbsence, setAvailableSlotsForAbsence] = useState<any[]>([]);
  const [slotsLoaded, setSlotsLoaded] = useState(false);

  const absenceForm = useForm<CreateAbsenceRequest>({
    resolver: zodResolver(createAbsenceRequestSchema),
    defaultValues: {
      childName: "",
      declaredClassBand: undefined,
      absentDateISO: "",
      originalSlotId: "",
      contactEmail: "",
    },
    mode: "onChange",
  });

  const searchForm = useForm<any>({
    resolver: zodResolver(searchSlotsRequestSchema),
    defaultValues: {
      childName: "",
      declaredClassBand: undefined,
      absentDateISO: "",
    },
    mode: "onChange",
  });

  // LocalStorageから保存された値を読み込み
  useEffect(() => {
    if (!token) {
      const savedName = localStorage.getItem("hamasui_childName");
      const savedClass = localStorage.getItem("hamasui_classBand");
      if (savedName) absenceForm.setValue("childName", savedName);
      if (savedClass) absenceForm.setValue("declaredClassBand", savedClass as any);
    }
  }, [token]);

  useEffect(() => {
    const subscription = absenceForm.watch((value, { name }) => {
      if ((name === "absentDateISO" || name === "declaredClassBand") &&
        value.absentDateISO && value.declaredClassBand) {
        setSlotsLoaded(false);
        apiRequest("GET", `/api/class-slots?date=${value.absentDateISO}&classBand=${value.declaredClassBand}`)
          .then((response: any) => {
            const slots = response.slots || [];
            const validSlots = slots.filter((s: any) => !s.isPastLesson);
            setAvailableSlotsForAbsence(slots);
            setSlotsLoaded(true);
            // 1つしかない場合は自動選択
            if (validSlots.length === 1) {
              absenceForm.setValue("originalSlotId", validSlots[0].id);
            } else {
              absenceForm.setValue("originalSlotId", "");
            }
          })
          .catch(() => {
            setAvailableSlotsForAbsence([]);
            setSlotsLoaded(true);
            absenceForm.setValue("originalSlotId", "");
          });
      }
    });
    return () => subscription.unsubscribe();
  }, [absenceForm]);

  const fetchSlots = async (childName: string, declaredClassBand: string, absentDate: string) => {
    try {
      const response: any = await apiRequest("GET", `/api/class-slots?date=${absentDate}&classBand=${declaredClassBand}`);
      setAvailableSlotsForAbsence(response.slots || []);
      setSearchParams2({
        childName: childName,
        declaredClassBand: declaredClassBand as "初級" | "中級" | "上級",
        absentDateISO: absentDate,
        absenceId: absenceData?.id,
      });
      if (absentDate) {
        setSelectedDate(new Date(absentDate));
      }
      setViewMode("calendar");
    } catch (error) {
      setAvailableSlotsForAbsence([]);
      setSearchParams2(null);
      toast({
        title: "エラー",
        description: "振替枠の検索に失敗しました",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (token) {
      apiRequest("GET", `/api/absences/${token}`)
        .then((data: AbsenceData) => {
          setAbsenceData({ ...data, resumeToken: token });
          searchForm.setValue("childName", data.childName);
          searchForm.setValue("declaredClassBand", data.declaredClassBand);
          searchForm.setValue("absentDateISO", data.absentDate);

          if (data.makeupStatus === "PENDING") {
            fetchSlots(data.childName, data.declaredClassBand, data.absentDate);
          }
        })
        .catch(() => {
          toast({
            title: "エラー",
            description: "欠席情報の読み込みに失敗しました",
            variant: "destructive",
          });
        });
    }
  }, [token]);

  const { data: slots, isLoading, error } = useQuery<SlotSearchResult[]>({
    queryKey: ["/api/search-slots", searchParams2],
    enabled: !!searchParams2,
    queryFn: async () => {
      if (!searchParams2) return [];
      return await apiRequest("POST", "/api/search-slots", searchParams2) as SlotSearchResult[];
    },
  });

  const handleAbsenceSuccess = (
    childName: string,
    declaredClassBand: string,
    absentDate: string,
    contactEmail: string | undefined,
    result: { absenceId: string; resumeToken: string; makeupDeadline: string; confirmCode?: string }
  ) => {
    setAbsenceData({
      id: result.absenceId,
      childName,
      declaredClassBand,
      absentDate,
      contactEmail: contactEmail || null,
      makeupDeadline: result.makeupDeadline,
      makeupStatus: "PENDING",
      confirmCode: result.confirmCode,
    });

    if (result.confirmCode) {
      setConfirmCode(result.confirmCode);
      setShowConfirmCodeDialog(true);
    }

    fetchSlots(childName, declaredClassBand, absentDate);
  };

  const onAbsenceSubmit = async (data: CreateAbsenceRequest) => {
    try {
      const slotsCheck = await apiRequest("GET", "/api/check-slots-availability");
      if (!slotsCheck.hasSlots) {
        toast({
          title: "レッスン枠が登録されていません",
          description: "現在、振替可能なレッスン枠が登録されていないため、欠席登録はできません。事務局にお問い合わせください。",
          variant: "destructive",
        });
        return;
      }

      const result: any = await apiRequest("POST", "/api/absences", data);

      // LocalStorageに保存
      localStorage.setItem("hamasui_childName", data.childName);
      localStorage.setItem("hamasui_classBand", data.declaredClassBand);

      toast({ title: "欠席連絡を受け付けました", description: "振替枠を自動的に検索します" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-lessons"] });
      handleAbsenceSuccess(data.childName, data.declaredClassBand, data.absentDateISO, data.contactEmail, result);
    } catch (error: any) {
      toast({ title: "エラー", description: error.message || "欠席連絡の登録に失敗しました", variant: "destructive" });
    }
  };

  const cancelAbsenceMutation = useMutation({
    mutationFn: (resumeToken: string) => apiRequest("POST", "/api/cancel-absence", { resumeToken }),
    onSuccess: () => {
      toast({
        title: "キャンセル完了",
        description: "欠席連絡をキャンセルしました。",
      });
      setAbsenceData(null);
      setSearchParams2(null);
      queryClient.invalidateQueries({ queryKey: ["/api/search-slots"] });
    },
    onError: (error: any) => {
      toast({
        title: "キャンセルエラー",
        description: error.message || "キャンセルに失敗しました。",
        variant: "destructive",
      });
    },
  });

  const handleCancelAbsence = () => {
    const resumeToken = absenceData?.resumeToken || token;
    if (absenceData && resumeToken && confirm("欠席連絡をキャンセルしますか？関連する予約もすべてキャンセルされます。")) {
      cancelAbsenceMutation.mutate(resumeToken);
    }
  };

  const handleBook = async (slotId: string) => {
    if (!searchParams2) return;

    try {
      const result = await apiRequest("POST", "/api/book", {
        absenceId: absenceData?.id,
        childName: searchParams2.childName,
        declaredClassBand: searchParams2.declaredClassBand,
        absentDateISO: searchParams2.absentDateISO,
        toSlotId: slotId,
      });

      toast({
        title: "予約完了",
        description: result.message || "振替予約が成立しました。",
      });

      if (absenceData) {
        setAbsenceData({ ...absenceData, makeupStatus: "MAKEUP_CONFIRMED" });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/search-slots"] });
    } catch (error: any) {
      toast({
        title: "予約エラー",
        description: error.message || "予約に失敗しました。",
        variant: "destructive",
      });
    }
  };

  const copyConfirmCode = () => {
    if (confirmCode) {
      navigator.clipboard.writeText(confirmCode);
      toast({
        title: "コピーしました",
        description: "確認コードをクリップボードにコピーしました。",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-filter supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">はまスイ 欠席・振替登録</h1>
          </div>
        </div>
      </header>

      <main className="container max-w-2xl px-4 py-8 md:py-12 space-y-8">
        {!absenceData && !token && (
          <Collapsible>
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <InfoIcon className="w-5 h-5 text-primary" />
                      はじめての方へ - システムの使い方
                    </h2>
                    <ChevronDownIcon className="w-5 h-5 text-primary transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 pt-0">
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">1</div>
                      <div>
                        <p className="font-semibold">欠席連絡を登録</p>
                        <p className="text-sm text-muted-foreground">お子様の名前、クラス帯、欠席日を入力して登録します</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
                      <div>
                        <p className="font-semibold">確認コードを保存</p>
                        <p className="text-sm text-muted-foreground">表示される6桁の確認コードをメモしてください（メールでも届きます）</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">3</div>
                      <div>
                        <p className="font-semibold">振替枠を検索・予約</p>
                        <p className="text-sm text-muted-foreground">振替可能な枠を検索し、予約できます</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm font-semibold text-yellow-800 mb-1">重要なお知らせ</p>
                    <ul className="text-sm text-yellow-700 space-y-1 list-disc list-inside">
                      <li><strong>確認コードは必ず保存してください</strong> - 予約確認・キャンセルに必要です</li>
                      <li>確認コードが分からなくなった場合は<strong>PICROでメッセージ</strong>をお送りください</li>
                      <li>欠席連絡は<strong>レッスン開始時間まで</strong>、振替登録は<strong>開始30分前まで</strong>に行ってください</li>
                      <li>メールアドレスを入力すると、振替確定時にも通知が届きます</li>
                      <li>満席の枠は予約できません</li>
                    </ul>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        <section>
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">STEP 1</p>
            <h2 className="text-2xl font-semibold">欠席連絡を登録</h2>
          </div>

          {absenceData ? (
            <Card className="border-2">
              <CardContent className="p-6">
                <div className="flex items-start gap-3 mb-4">
                  <CheckCircleIcon className="w-5 h-5 text-green-500 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold mb-2">欠席連絡が登録されています</p>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p>お子様の名前: <span className="font-medium text-foreground">{absenceData.childName}</span></p>
                      <p>クラス帯: <span className="font-medium text-foreground">{absenceData.declaredClassBand}</span></p>
                      <p>欠席日: <span className="font-medium text-foreground">{format(parseLocalDate(absenceData.absentDate), "yyyy年M月d日(E)", { locale: ja })}</span></p>
                      <p>振替期限: <span className="font-medium text-foreground">{format(parseLocalDate(absenceData.makeupDeadline), "yyyy年M月d日", { locale: ja })}</span></p>
                    </div>
                  </div>
                </div>
                {new Date(absenceData.makeupDeadline) >= new Date() && (
                  <Button
                    onClick={handleCancelAbsence}
                    variant="outline"
                    className="w-full"
                    data-testid="button-cancel-absence"
                  >
                    <XCircleIcon className="w-4 h-4 mr-2" />
                    欠席連絡をキャンセル
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-2">
              <CardContent className="p-6">
                <Form {...absenceForm}>
                  <form onSubmit={absenceForm.handleSubmit(onAbsenceSubmit)} className="space-y-6">
                    <FormField
                      control={absenceForm.control}
                      name="childName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>お子様の名前</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="例：山田太郎"
                              className="h-12"
                              data-testid="input-child-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={absenceForm.control}
                      name="declaredClassBand"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>クラス帯</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-12" data-testid="select-class-band">
                                <SelectValue placeholder="クラス帯を選択" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="初級">初級</SelectItem>
                              <SelectItem value="中級">中級</SelectItem>
                              <SelectItem value="上級">上級</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={absenceForm.control}
                      name="absentDateISO"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>欠席予定日</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
                              <Input
                                type="date"
                                {...field}
                                className="h-12 pl-10"
                                data-testid="input-absent-date"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={absenceForm.control}
                      name="originalSlotId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>欠席するレッスン枠</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                            disabled={availableSlotsForAbsence.length === 0}
                          >
                            <FormControl>
                              <SelectTrigger className="h-12" data-testid="select-original-slot">
                                <SelectValue placeholder={availableSlotsForAbsence.length === 0 ? "日付とクラス帯を選択してください" : "レッスン枠を選択"} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availableSlotsForAbsence.filter(s => !s.isPastLesson).map((slot) => (
                                <SelectItem key={slot.id} value={slot.id}>
                                  {slot.startTime} - {slot.courseLabel}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {slotsLoaded && availableSlotsForAbsence.filter(s => !s.isPastLesson).length === 0 &&
                            absenceForm.watch("absentDateISO") &&
                            absenceForm.watch("declaredClassBand") && (
                              <p className="text-sm text-destructive mt-1">
                                この日の{absenceForm.watch("declaredClassBand")}クラスのレッスンはありません
                              </p>
                            )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={absenceForm.control}
                      name="contactEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            通知用メールアドレス
                            <span className="text-muted-foreground text-xs ml-2">（任意）</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              placeholder="example@email.com"
                              className="h-12"
                              data-testid="input-contact-email"
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            入力すると確認コードと欠席完了通知がメールで届きます
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full h-12 text-base font-semibold"
                      data-testid="button-submit-absence"
                    >
                      欠席連絡を登録
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}
        </section>

        <section>
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase text-muted-foreground">STEP 2</p>
            <h2 className="text-2xl font-semibold">振替枠の候補</h2>
          </div>

          {absenceData ? (
            absenceData.makeupStatus === "MAKEUP_CONFIRMED" ? (
              <Card className="border-2 bg-muted/40">
                <CardContent className="p-12 text-center text-muted-foreground">
                  すでに振替予約が確定済みです。別の枠への変更は事務局へお問い合わせください。
                </CardContent>
              </Card>
            ) : new Date(absenceData.makeupDeadline) < new Date() ? (
              <Card className="border-2 bg-muted/40">
                <CardContent className="p-12 text-center text-muted-foreground">
                  振替の受付期限が過ぎています。新しい欠席連絡からやり直してください。
                </CardContent>
              </Card>
            ) : (
              <Card className="border-2 bg-muted/50">
                <CardContent className="p-6">
                  <div className="grid gap-3 md:grid-cols-3 text-sm">
                    <div>
                      <p className="text-muted-foreground mb-1">お子様の名前</p>
                      <p className="font-semibold">{absenceData.childName}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">クラス帯</p>
                      <p className="font-semibold">{absenceData.declaredClassBand}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">欠席日</p>
                      <p className="font-semibold">{format(parseLocalDate(absenceData.absentDate), "yyyy/MM/dd (E)", { locale: ja })}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    上記の欠席連絡をもとに、振替可能な枠を表示しています
                  </p>
                </CardContent>
              </Card>
            )
          ) : (
            <Card className="border-2 bg-muted/40">
              <CardContent className="p-12 text-center text-muted-foreground">
                振替枠を確認するには、まず欠席連絡を登録してください。
              </CardContent>
            </Card>
          )}
        </section>

        {searchParams2 && absenceData && new Date(absenceData.makeupDeadline) >= new Date() && (
          <section>
            <h2 className="text-2xl font-semibold mb-6">検索結果</h2>

            {isLoading && (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            )}

            {!isLoading && slots && slots.length === 0 && (
              <Card className="border-2">
                <CardContent className="p-12 text-center">
                  <ClockIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg text-muted-foreground">
                    条件に合う振替枠が見つかりませんでした
                  </p>
                </CardContent>
              </Card>
            )}

            {slots && slots.length > 0 && (
              <Card className="border-2">
                <CardHeader className="p-6 flex-row items-start justify-between gap-4 space-y-0">
                  <div>
                    <h2 className="text-2xl font-bold">検索結果</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {slots.length}件の振替可能枠が見つかりました
                    </p>
                  </div>
                  <div className="flex border-2 rounded-lg overflow-hidden">
                    <Button
                      variant={viewMode === "list" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => {
                        setViewMode("list");
                        localStorage.setItem("hamasui_viewMode", "list");
                      }}
                      className="rounded-none"
                    >
                      <ListIcon className="w-4 h-4 mr-2" />
                      リスト
                    </Button>
                    <Button
                      variant={viewMode === "calendar" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => {
                        setViewMode("calendar");
                        localStorage.setItem("hamasui_viewMode", "calendar");
                      }}
                      className="rounded-none"
                    >
                      <CalendarIcon className="w-4 h-4 mr-2" />
                      カレンダー
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-6 pt-0">
                  {viewMode === "calendar" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="flex justify-center">
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={setSelectedDate}
                          modifiers={{
                            hasSlots: slots.map(s => new Date(s.date)),
                          }}
                          modifiersClassNames={{
                            hasSlots: "bg-primary/20 text-primary-foreground font-bold",
                          }}
                          className="rounded-md border"
                        />
                      </div>
                      <div className="space-y-3">
                        {selectedDate && (
                          <>
                            <p className="font-semibold">
                              {format(selectedDate, "yyyy年M月d日(E)", { locale: ja })}の振替枠
                            </p>
                            {slots
                              .filter(s => format(parseLocalDate(s.date), "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd"))
                              .map(slot => (
                                <SlotCard
                                  key={slot.slotId}
                                  slot={slot}
                                  onBook={handleBook}
                                  absenceId={absenceData?.id}
                                />
                              ))
                            }
                            {slots.filter(s => format(parseLocalDate(s.date), "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd")).length === 0 && (
                              <p className="text-muted-foreground text-sm">この日に利用可能な枠はありません</p>
                            )}
                          </>
                        )}
                        {!selectedDate && (
                          <p className="text-muted-foreground text-sm">カレンダーから日付を選択してください</p>
                        )}
                      </div>
                    </div>
                  )}
                  {viewMode === "list" && (
                    <div className="space-y-3">
                      {slots.map(slot => (
                        <SlotCard
                          key={slot.slotId}
                          slot={slot}
                          onBook={handleBook}
                          absenceId={absenceData?.id}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </section>
        )}
      </main>


      <Dialog open={showConfirmCodeDialog} onOpenChange={setShowConfirmCodeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">欠席連絡を受け付けました</DialogTitle>
            <DialogDescription className="text-center">
              下記の確認コードを必ずメモしてください。<br />
              予約確認・キャンセルに必要です。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">確認コード</p>
              <div className="flex items-center justify-center gap-2 mb-4">
                <span
                  className="text-4xl font-bold tracking-[0.3em] font-mono text-primary"
                  data-testid="text-confirm-code"
                >
                  {confirmCode}
                </span>
              </div>
              <Button
                onClick={copyConfirmCode}
                variant="outline"
                className="w-full mb-2"
                data-testid="button-copy-code"
              >
                <CopyIcon className="w-5 h-5 mr-2" />
                確認コードをコピー
              </Button>
              <p className="text-sm font-bold text-primary">
                📸 スクリーンショットで保存してください
              </p>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800 w-full">
              <p className="font-semibold mb-1">重要</p>
              <ul className="list-disc list-inside space-y-1">
                <li>この確認コードはスクリーンショットやメモで保存してください</li>
                <li>「予約確認」ページからコードを入力すると予約状況を確認できます</li>
                <li>メールアドレスを入力した場合は、メールでも確認コードが届きます</li>
              </ul>
            </div>
          </div>
          <Button
            onClick={() => setShowConfirmCodeDialog(false)}
            className="w-full"
            data-testid="button-close-confirm-dialog"
          >
            確認しました
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SlotCardProps = {
  slot: SlotSearchResult;
  onBook: (slotId: string) => void;
  absenceId?: string;
};

function SlotCard({ slot, onBook, absenceId }: SlotCardProps) {
  const capacityMakeupAllowed = (slot.capacityLimit || 0) - (slot.capacityCurrent || 0);
  const actualRemainingSlots = Math.max(0, capacityMakeupAllowed - (slot.capacityMakeupUsed || 0));

  return (
    <Card
      className="border-2 hover:border-primary/50 transition-all"
      data-testid={`slot-card-${slot.slotId}`}
    >
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <CalendarIcon className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-base">
                {format(parseLocalDate(slot.date), "yyyy年M月d日(E)", { locale: ja })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{slot.startTime}</span>
              <Badge variant="outline">{slot.classBand}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{slot.courseLabel}</p>
          </div>
          <div className="text-right">
            <Badge
              className={
                slot.statusCode === "〇"
                  ? "bg-green-500 hover:bg-green-600"
                  : slot.statusCode === "△"
                    ? "bg-yellow-500 hover:bg-yellow-600"
                    : "bg-red-500 hover:bg-red-600"
              }
            >
              {slot.statusCode}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="bg-muted/50 rounded-lg p-3 mb-3">
          <p className="text-sm font-medium">{slot.statusText}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="text-center p-2 bg-background rounded border">
            <p className="text-muted-foreground text-xs">定員</p>
            <p className="font-semibold">{slot.capacityLimit || 0}</p>
          </div>
          <div className="text-center p-2 bg-background rounded border">
            <p className="text-muted-foreground text-xs">現在</p>
            <p className="font-semibold">{slot.capacityCurrent || 0}</p>
          </div>
          <div className="text-center p-2 bg-background rounded border">
            <p className="text-muted-foreground text-xs">振替枠</p>
            <p className="font-semibold">{actualRemainingSlots}</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 gap-2">
        {actualRemainingSlots > 0 ? (
          <Button
            onClick={() => onBook(slot.slotId)}
            className="flex-1"
            data-testid={`button-book-${slot.slotId}`}
          >
            <CheckCircleIcon className="w-4 h-4 mr-2" />
            この枠で予約する
          </Button>
        ) : (
          <Button
            variant="outline"
            className="flex-1"
            disabled
            data-testid={`button-full-${slot.slotId}`}
          >
            <XCircleIcon className="w-4 h-4 mr-2" />
            満席
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

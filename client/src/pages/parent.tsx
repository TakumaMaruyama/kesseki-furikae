import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createAbsencesBatchRequestSchema,
  type CreateAbsenceRequest,
  type CreateAbsencesBatchRequest,
  type SearchSlotsRequest,
  type SlotSearchResult,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import {
  CalendarIcon, CheckCircleIcon, AlertTriangleIcon, ClockIcon,
  ListIcon, InfoIcon, XCircleIcon, ChevronDownIcon, CopyIcon, PlusIcon, Trash2Icon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { addJstDays, formatJstDate, parseJstDate } from "@shared/jst";
import { getActualCurrent, getRemainingCapacity } from "@shared/capacity";

type ReportType = "ABSENCE" | "LATE";

type AbsenceData = {
  id: string;
  childName: string;
  declaredClassBand: "初級" | "中級" | "上級";
  reportType: ReportType;
  absentDate: string;
  originalSlotId?: string;
  contactEmail: string | null;
  reason?: string | null;
  sourceType?: "NORMAL" | "CLOSURE_CODE";
  closureEventId?: string | null;
  makeupDeadline: string;
  makeupStatus: string;
  resumeToken?: string;
  confirmCode?: string;
};

type ClassSlotOption = {
  id: string;
  date: string;
  startTime: string;
  courseLabel: string;
  classBand: "初級" | "中級" | "上級";
  lessonStartDateTime?: string;
  isPastLesson?: boolean;
  isClosed?: boolean;
};

type BatchResultItem = {
  absenceId: string;
  resumeToken: string;
  confirmCode: string;
  makeupDeadline: string;
  childName: string;
  declaredClassBand: "初級" | "中級" | "上級";
  absentDateISO: string;
  reportType: ReportType;
};

type SingleAbsenceSubmitResult = {
  absenceId: string;
  resumeToken: string;
  confirmCode: string;
  makeupDeadline: string;
  reportType?: ReportType;
};

type ClosureValidationResult = {
  id: string;
  name: string;
  sharedCode: string;
  usageLimit: number;
  usageUsed: number;
  usageRemaining: number;
  expiresAt: string;
  slots: ClassSlotOption[];
};

const CLASS_BANDS: Array<"初級" | "中級" | "上級"> = ["初級", "中級", "上級"];
const EMAIL_NOTICE_START_ISO = "2026-04-13";
const EMAIL_NOTICE_END_ISO = "2026-04-17";
const EMAIL_NOTICE_MESSAGE = "2026年4月13日(月)〜4月17日(金)は、通知用メールアドレスを入力しても、確認コードや欠席・遅刻完了通知メールが届かない場合があります。確認コードは画面上で必ず保存してください。";
const EMAIL_FIELD_NOTICE_MESSAGE = "現在はメールが届かない場合があります。確認コードは画面表示を保存してください。";
const EMAIL_CONFIRM_NOTICE_MESSAGE = "メールアドレスを入力した場合も、現在は確認コードがメールで届かない場合があります";

function getReportTypeLabel(reportType: ReportType): string {
  return reportType === "LATE" ? "遅刻" : "欠席";
}

// Helper to safely parse date string to local Date object avoiding timezone shifts
const parseLocalDate = (dateStr: any) => {
  if (!dateStr) return new Date();
  // If it's already a Date object, return it
  if (dateStr instanceof Date) return dateStr;
  
  // Handle ISO string or date only string
  const dateStrStr = String(dateStr);
  const datePart = dateStrStr.includes('T') ? dateStrStr.split('T')[0] : dateStrStr;
  const [year, month, day] = datePart.split('-').map(Number);
  return new Date(year, month - 1, day);
};

async function postJsonWithDetails(url: string, data: unknown): Promise<any> {
  return apiRequest("POST", url, data);
}

function buildSingleAbsencePayload(data: CreateAbsencesBatchRequest): CreateAbsenceRequest | null {
  if (data.reportType !== "ABSENCE" || data.items.length !== 1) {
    return null;
  }

  const [item] = data.items;
  if (!item) {
    return null;
  }

  return {
    childId: item.childId,
    childName: item.childName,
    declaredClassBand: item.declaredClassBand,
    absentDateISO: item.absentDateISO,
    originalSlotId: item.originalSlotId,
    reportType: data.reportType,
    contactEmail: data.contactEmail,
    reason: data.reason,
  };
}

function shouldRetryBatchAbsenceAsSingle(error: any): boolean {
  const message = String(error?.message || "");

  if (message.includes("APIの代わりにHTMLが返されました")) {
    return true;
  }

  if (error?.status === 403) {
    return true;
  }

  if (error?.status !== 400) {
    return false;
  }

  return (
    /"expected":\s*"array"/.test(message) ||
    /"received":\s*"undefined"/.test(message) ||
    /"path":\s*\[\s*"items"/.test(message) ||
    /少なくとも1名分の欠席情報/.test(message)
  );
}

function normalizeSingleAbsenceResultAsBatch(
  result: SingleAbsenceSubmitResult,
  request: CreateAbsenceRequest,
): { success: true; items: BatchResultItem[] } {
  return {
    success: true,
    items: [{
      absenceId: result.absenceId,
      resumeToken: result.resumeToken,
      confirmCode: result.confirmCode,
      makeupDeadline: result.makeupDeadline,
      childName: request.childName,
      declaredClassBand: request.declaredClassBand,
      absentDateISO: request.absentDateISO,
      reportType: result.reportType || request.reportType || "ABSENCE",
    }],
  };
}

async function submitNormalAbsenceWithFallback(
  data: CreateAbsencesBatchRequest,
): Promise<{ success?: boolean; items: BatchResultItem[] }> {
  try {
    return await postJsonWithDetails("/api/absences/batch", data);
  } catch (batchError: any) {
    const singlePayload = buildSingleAbsencePayload(data);
    if (!singlePayload || !shouldRetryBatchAbsenceAsSingle(batchError)) {
      throw batchError;
    }

    const singleResult = await postJsonWithDetails("/api/absences", singlePayload) as SingleAbsenceSubmitResult;
    return normalizeSingleAbsenceResultAsBatch(singleResult, singlePayload);
  }
}

function buildResumeUrl(token: string): string {
  return `${window.location.origin}/?token=${token}`;
}

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
  const [confirmItems, setConfirmItems] = useState<BatchResultItem[]>([]);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const reasonInputRef = useRef<HTMLInputElement | null>(null);
  const contactEmailInputRef = useRef<HTMLInputElement | null>(null);
  const [slotOptionsByKey, setSlotOptionsByKey] = useState<Record<string, ClassSlotOption[]>>({});
  const [loadingSlotKeys, setLoadingSlotKeys] = useState<Set<string>>(new Set());
  const [closureCode, setClosureCode] = useState("");
  const [closureValidation, setClosureValidation] = useState<ClosureValidationResult | null>(null);
  const [isValidatingClosureCode, setIsValidatingClosureCode] = useState(false);
  const isClosureMode = !!closureValidation;
  const isAbsenceCancelled = (status: string) => status === "CANCELLED" || status === "EXPIRED";

  const isMakeupDeadlineOpen = (deadlineISO: string) => {
    const deadlineEndExclusive = addJstDays(parseJstDate(deadlineISO), 1);
    return deadlineEndExclusive > new Date();
  };

  const absenceForm = useForm<CreateAbsencesBatchRequest>({
    resolver: zodResolver(createAbsencesBatchRequestSchema),
    defaultValues: {
      reportType: "ABSENCE",
      items: [{
        childName: "",
        declaredClassBand: undefined,
        absentDateISO: "",
        originalSlotId: "",
      }],
      contactEmail: "",
      reason: "",
    },
    mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({
    control: absenceForm.control,
    name: "items",
  });
  const watchedItems = absenceForm.watch("items");
  const selectedReportType = absenceForm.watch("reportType");
  const isLateReport = selectedReportType === "LATE";
  const optionalReasonValue = absenceForm.watch("reason");
  const optionalContactEmailValue = absenceForm.watch("contactEmail");
  const isOptionalSectionOpen = optionalOpen || !!optionalReasonValue?.trim() || !!optionalContactEmailValue?.trim();
  const todayJst = formatJstDate(new Date());
  const isEmailNoticeActive = todayJst >= EMAIL_NOTICE_START_ISO && todayJst <= EMAIL_NOTICE_END_ISO;
  const showEmailNoticeBanner = isEmailNoticeActive && !absenceData && !token;

  useEffect(() => {
    if (isClosureMode && absenceForm.getValues("reportType") !== "ABSENCE") {
      absenceForm.setValue("reportType", "ABSENCE", { shouldDirty: true, shouldValidate: true });
    }
  }, [isClosureMode, absenceForm]);

  const openOptionalAndFocus = (target: "reason" | "contactEmail") => {
    setOptionalOpen(true);
    window.setTimeout(() => {
      const inputElement = target === "reason" ? reasonInputRef.current : contactEmailInputRef.current;
      inputElement?.focus();
    }, 0);
  };

  const getSlotCacheKey = (absentDateISO?: string, declaredClassBand?: string) => {
    if (!absentDateISO || !declaredClassBand) return "";
    return `${absentDateISO}__${declaredClassBand}`;
  };

  const ensureNormalSlotOptions = async (absentDateISO: string, declaredClassBand: "初級" | "中級" | "上級") => {
    const key = getSlotCacheKey(absentDateISO, declaredClassBand);
    if (!key) return [] as ClassSlotOption[];
    if (slotOptionsByKey[key]) return slotOptionsByKey[key];
    if (loadingSlotKeys.has(key)) return [] as ClassSlotOption[];

    setLoadingSlotKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    try {
      const response = await apiRequest("GET", `/api/class-slots?date=${absentDateISO}&classBand=${declaredClassBand}`);
      const slots = (response?.slots || []) as ClassSlotOption[];
      setSlotOptionsByKey((prev) => ({ ...prev, [key]: slots }));
      return slots;
    } catch (error: any) {
      setSlotOptionsByKey((prev) => ({ ...prev, [key]: [] }));
      toast({
        title: "レッスン枠の取得に失敗しました",
        description: error?.message || "対象日のレッスン枠を読み込めませんでした。",
        variant: "destructive",
      });
      return [] as ClassSlotOption[];
    } finally {
      setLoadingSlotKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const getClosureRowSlotOptions = (row: CreateAbsencesBatchRequest["items"][number] | undefined) => {
    if (!closureValidation) return [] as ClassSlotOption[];
    if (!row) return closureValidation.slots;

    const hasDate = !!row.absentDateISO;
    const hasBand = !!row.declaredClassBand;

    if (hasDate && hasBand) {
      return closureValidation.slots.filter(
        (slot) => slot.date === row.absentDateISO && slot.classBand === row.declaredClassBand,
      );
    }
    if (hasDate) {
      return closureValidation.slots.filter((slot) => slot.date === row.absentDateISO);
    }
    if (hasBand) {
      return closureValidation.slots.filter((slot) => slot.classBand === row.declaredClassBand);
    }

    return closureValidation.slots;
  };

  const activateSearchFromAbsence = (data: {
    id: string;
    childName: string;
    declaredClassBand: "初級" | "中級" | "上級";
    absentDate: string;
  }) => {
    setSearchParams2({
      childName: data.childName,
      declaredClassBand: data.declaredClassBand,
      absentDateISO: data.absentDate,
      absenceId: data.id,
    });
    setSelectedDate(parseJstDate(data.absentDate));
    setViewMode("calendar");
  };

  // LocalStorageから保存された値を読み込み
  useEffect(() => {
    if (!token) {
      const savedName = localStorage.getItem("hamasui_childName");
      const savedClass = localStorage.getItem("hamasui_classBand") as "初級" | "中級" | "上級" | null;
      if (savedName) absenceForm.setValue("items.0.childName", savedName);
      if (savedClass) absenceForm.setValue("items.0.declaredClassBand", savedClass);
    }
  }, [token, absenceForm]);

  useEffect(() => {
    if (token) {
      apiRequest("GET", `/api/absences/${token}`)
        .then((data: AbsenceData) => {
          const typedClassBand = data.declaredClassBand as "初級" | "中級" | "上級";
          const typedReportType = (data.reportType || "ABSENCE") as ReportType;
          setAbsenceData({ ...data, declaredClassBand: typedClassBand, reportType: typedReportType, resumeToken: token });

          if (data.makeupStatus === "PENDING" && typedReportType === "ABSENCE") {
            activateSearchFromAbsence({
              id: data.id,
              childName: data.childName,
              declaredClassBand: typedClassBand,
              absentDate: data.absentDate,
            });
          } else {
            setSearchParams2(null);
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

  const { data: slots, isLoading } = useQuery<SlotSearchResult[]>({
    queryKey: ["/api/search-slots", searchParams2],
    enabled: !!searchParams2,
    queryFn: async () => {
      if (!searchParams2) return [];
      return await apiRequest("POST", "/api/search-slots", searchParams2) as SlotSearchResult[];
    },
  });

  const handleValidateClosureCode = async () => {
    if (!closureCode.trim()) {
      toast({
        title: "入力エラー",
        description: "共通コードを入力してください。",
        variant: "destructive",
      });
      return;
    }

    setIsValidatingClosureCode(true);
    try {
      const result = await apiRequest("POST", "/api/closure-events/validate-code", { sharedCode: closureCode }) as ClosureValidationResult;
      setClosureValidation(result);
      setClosureCode(result.sharedCode);
      absenceForm.setValue("reportType", "ABSENCE", { shouldDirty: true, shouldValidate: true });

      const firstSlot = result.slots[0];
      if (firstSlot) {
        absenceForm.setValue("items.0.absentDateISO", firstSlot.date);
        absenceForm.setValue("items.0.declaredClassBand", firstSlot.classBand);
        absenceForm.setValue("items.0.originalSlotId", firstSlot.id);
      }

      toast({
        title: "休講コードを確認しました",
        description: "このコードで振替権を登録できます。",
      });
    } catch (error: any) {
      setClosureValidation(null);
      toast({
        title: "コード確認エラー",
        description: error.message || "共通コードの検証に失敗しました。",
        variant: "destructive",
      });
    } finally {
      setIsValidatingClosureCode(false);
    }
  };

  const clearClosureMode = () => {
    setClosureValidation(null);
    setClosureCode("");
  };

  const handleAddRow = async () => {
    if (fields.length >= 5) {
      toast({
        title: "追加できません",
        description: "一度に登録できるのは5名までです。",
        variant: "destructive",
      });
      return;
    }

    const firstRow = absenceForm.getValues("items.0");
    append({
      childName: "",
      declaredClassBand: firstRow?.declaredClassBand,
      absentDateISO: firstRow?.absentDateISO || "",
      originalSlotId: firstRow?.originalSlotId || "",
    });

    if (!isClosureMode && firstRow?.absentDateISO && firstRow?.declaredClassBand) {
      await ensureNormalSlotOptions(firstRow.absentDateISO, firstRow.declaredClassBand);
    }
  };

  const handleRemoveRow = (index: number) => {
    if (fields.length <= 1) return;
    remove(index);
  };

  const handleRowClassBandChange = async (index: number, classBand: "初級" | "中級" | "上級") => {
    const currentDate = absenceForm.getValues(`items.${index}.absentDateISO` as const);

    absenceForm.setValue(`items.${index}.declaredClassBand` as const, classBand, { shouldDirty: true, shouldValidate: true });
    absenceForm.setValue(`items.${index}.originalSlotId` as const, "", { shouldDirty: true, shouldValidate: true });

    if (!isClosureMode && currentDate) {
      const slots = await ensureNormalSlotOptions(currentDate, classBand);
      const validSlots = slots.filter((slot) => !slot.isPastLesson);
      if (validSlots.length === 1) {
        absenceForm.setValue(`items.${index}.originalSlotId` as const, validSlots[0].id, { shouldDirty: true, shouldValidate: true });
      }
    }
  };

  const handleRowDateChange = async (index: number, absentDateISO: string) => {
    const classBand = absenceForm.getValues(`items.${index}.declaredClassBand` as const);

    absenceForm.setValue(`items.${index}.absentDateISO` as const, absentDateISO, { shouldDirty: true, shouldValidate: true });
    absenceForm.setValue(`items.${index}.originalSlotId` as const, "", { shouldDirty: true, shouldValidate: true });

    if (!isClosureMode && classBand) {
      const slots = await ensureNormalSlotOptions(absentDateISO, classBand);
      const validSlots = slots.filter((slot) => !slot.isPastLesson);
      if (validSlots.length === 1) {
        absenceForm.setValue(`items.${index}.originalSlotId` as const, validSlots[0].id, { shouldDirty: true, shouldValidate: true });
      }
    }
  };

  const handleRowOriginalSlotChange = (index: number, slotId: string) => {
    absenceForm.setValue(`items.${index}.originalSlotId` as const, slotId, { shouldDirty: true, shouldValidate: true });

    if (!closureValidation) return;
    const matchedSlot = closureValidation.slots.find((slot) => slot.id === slotId);
    if (!matchedSlot) return;

    absenceForm.setValue(`items.${index}.absentDateISO` as const, matchedSlot.date, { shouldDirty: true, shouldValidate: true });
    absenceForm.setValue(`items.${index}.declaredClassBand` as const, matchedSlot.classBand, { shouldDirty: true, shouldValidate: true });
  };

  const onAbsenceSubmit = async (data: CreateAbsencesBatchRequest) => {
    try {
      if (!isClosureMode && data.reportType === "ABSENCE") {
        const slotsCheck = await apiRequest("GET", "/api/check-slots-availability");
        if (!slotsCheck.hasSlots) {
          toast({
            title: "レッスン枠が登録されていません",
            description: "現在、振替可能なレッスン枠が登録されていないため、欠席登録はできません。事務局にお問い合わせください。",
            variant: "destructive",
          });
          return;
        }
      }

      const result = isClosureMode
        ? await postJsonWithDetails("/api/closure-events/redeem", {
            ...data,
            reportType: "ABSENCE" as const,
            sharedCode: closureValidation?.sharedCode,
          })
        : await submitNormalAbsenceWithFallback(data);
      const items = ((result?.items || []) as BatchResultItem[]).map((item) => ({
        ...item,
        reportType: item.reportType || data.reportType || "ABSENCE",
      }));

      if (items.length === 0) {
        throw new Error("欠席登録結果を取得できませんでした。");
      }

      const firstFormRow = data.items[0];
      if (firstFormRow) {
        localStorage.setItem("hamasui_childName", firstFormRow.childName);
        localStorage.setItem("hamasui_classBand", firstFormRow.declaredClassBand);
      }

      const firstItem = items[0];
      setConfirmItems(items);
      setShowConfirmCodeDialog(true);

      const firstAbsence: AbsenceData = {
        id: firstItem.absenceId,
        childName: firstItem.childName,
        declaredClassBand: firstItem.declaredClassBand,
        reportType: firstItem.reportType,
        absentDate: firstItem.absentDateISO,
        originalSlotId: firstFormRow?.originalSlotId,
        contactEmail: data.contactEmail?.trim() ? data.contactEmail.trim() : null,
        reason: data.reason?.trim() ? data.reason.trim() : null,
        makeupDeadline: firstItem.makeupDeadline,
        makeupStatus: "PENDING",
        sourceType: isClosureMode ? "CLOSURE_CODE" : "NORMAL",
        closureEventId: isClosureMode ? closureValidation?.id || null : null,
        resumeToken: firstItem.resumeToken,
        confirmCode: firstItem.confirmCode,
      };

      setAbsenceData(firstAbsence);
      if (firstAbsence.reportType === "ABSENCE") {
        activateSearchFromAbsence({
          id: firstAbsence.id,
          childName: firstAbsence.childName,
          declaredClassBand: firstAbsence.declaredClassBand,
          absentDate: firstAbsence.absentDate,
        });
      } else {
        setSearchParams2(null);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/admin/daily-lessons"] });
      toast({
        title: `${getReportTypeLabel(firstAbsence.reportType)}連絡を受け付けました`,
        description: "確認コード一覧を表示しています。",
      });
    } catch (error: any) {
      const rowSuffix = typeof error?.rowIndex === "number" ? `（${error.rowIndex + 1}行目）` : "";
      toast({
        title: "エラー",
        description: `${error.message || "欠席連絡の登録に失敗しました"}${rowSuffix}`,
        variant: "destructive",
      });
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
        description: error?.message || error?.error || "キャンセルに失敗しました。ページを再読み込みして再度お試しください。",
        variant: "destructive",
      });
    },
  });

  const handleCancelAbsence = () => {
    if (cancelAbsenceMutation.isPending) return;

    if (!absenceData) {
      toast({
        title: "キャンセルできません",
        description: "欠席情報が見つかりません。ページを再読み込みしてください。",
        variant: "destructive",
      });
      return;
    }

    const resumeToken = absenceData?.resumeToken || token;
    if (!resumeToken) {
      toast({
        title: "キャンセルできません",
        description: "識別トークンが見つかりません。トップページを開き直してから再試行してください。",
        variant: "destructive",
      });
      return;
    }

    const reportTypeLabel = getReportTypeLabel(absenceData.reportType);
    if (confirm(`${reportTypeLabel}連絡をキャンセルしますか？関連する予約もすべてキャンセルされます。`)) {
      cancelAbsenceMutation.mutate(resumeToken);
    }
  };

  const handleBook = async (slotId: string) => {
    if (!searchParams2) return;
    if (absenceData?.reportType === "LATE") {
      toast({
        title: "予約できません",
        description: "遅刻連絡では振替予約できません。",
        variant: "destructive",
      });
      return;
    }

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

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: "コピーしました",
        description: successMessage,
      });
    } catch {
      toast({
        title: "コピー失敗",
        description: "クリップボードへのコピーに失敗しました。",
        variant: "destructive",
      });
    }
  };

  const canSearchMakeup = !!absenceData
    && absenceData.reportType === "ABSENCE"
    && absenceData.makeupStatus === "PENDING"
    && isMakeupDeadlineOpen(absenceData.makeupDeadline);

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
        {showEmailNoticeBanner && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4" data-testid="email-feature-notice">
            <p className="mb-1 text-sm font-semibold text-yellow-800">重要なお知らせ</p>
            <p className="text-sm text-yellow-700">{EMAIL_NOTICE_MESSAGE}</p>
          </div>
        )}

        {!absenceData && !token && (
          <Collapsible>
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CollapsibleTrigger className="w-full">
                <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base sm:text-lg md:text-xl font-bold flex items-center gap-2 whitespace-nowrap">
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
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
                      <div>
                        <p className="font-semibold">確認コードを保存</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">3</div>
                      <div>
                        <p className="font-semibold">振替枠を検索・予約</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm font-semibold text-yellow-800 mb-1">重要なお知らせ</p>
                    <ul className="text-sm text-yellow-700 space-y-1 list-disc list-inside">
                      <li><strong>確認コードは必ず保存してください</strong> - 予約確認・キャンセルに必要です</li>
                      <li>確認コードが分からなくなった場合は<strong>PICROでメッセージ</strong>をお送りください</li>
                      <li><strong>欠席連絡はレッスン開始時刻までです。開始後は振替登録できません。</strong></li>
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
            <h2 className="text-2xl font-semibold">欠席・遅刻連絡を登録</h2>
          </div>

          {absenceData ? (
            <Card className="border-2">
              <CardContent className="p-6">
                <div className="flex items-start gap-3 mb-4">
                  <CheckCircleIcon className="w-5 h-5 text-green-500 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold mb-2">{getReportTypeLabel(absenceData.reportType)}連絡が登録されています</p>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p>お子様の名前: <span className="font-medium text-foreground">{absenceData.childName}</span></p>
                      <p>区分: <span className="font-medium text-foreground">{getReportTypeLabel(absenceData.reportType)}</span></p>
                      <p>クラス帯: <span className="font-medium text-foreground">{absenceData.declaredClassBand}</span></p>
                      <p>{absenceData.reportType === "LATE" ? "対象日" : "欠席日"}: <span className="font-medium text-foreground">{format(parseLocalDate(absenceData.absentDate), "yyyy年M月d日(E)", { locale: ja })}</span></p>
                      <p>
                        確認コード:{" "}
                        <span className="font-mono font-semibold tracking-[0.12em] text-foreground" data-testid="text-absence-confirm-code">
                          {absenceData.confirmCode || "-"}
                        </span>
                      </p>
                      {absenceData.reportType === "ABSENCE" && (
                        <p>振替期限: <span className="font-medium text-foreground">{format(parseLocalDate(absenceData.makeupDeadline), "yyyy年M月d日", { locale: ja })}</span></p>
                      )}
                    </div>
                  </div>
                </div>
                {isMakeupDeadlineOpen(absenceData.makeupDeadline) && !isAbsenceCancelled(absenceData.makeupStatus) && (
                  <Button
                    onClick={handleCancelAbsence}
                    variant="outline"
                    className="w-full"
                    disabled={cancelAbsenceMutation.isPending}
                    data-testid="button-cancel-absence"
                  >
                    <XCircleIcon className="w-4 h-4 mr-2" />
                    {cancelAbsenceMutation.isPending ? "キャンセル中..." : `${getReportTypeLabel(absenceData.reportType)}連絡をキャンセル`}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-2">
              <CardContent className="p-4 sm:p-6 space-y-6">
                <Form {...absenceForm}>
                  <form onSubmit={absenceForm.handleSubmit(onAbsenceSubmit)} className="space-y-6">
                    <FormField
                      control={absenceForm.control}
                      name="reportType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>連絡区分</FormLabel>
                          <FormControl>
                            <div className="inline-flex w-full rounded-lg border p-1">
                              <Button
                                type="button"
                                variant={field.value === "ABSENCE" ? "default" : "ghost"}
                                className="flex-1"
                                onClick={() => field.onChange("ABSENCE")}
                                data-testid="button-report-type-absence"
                              >
                                欠席
                              </Button>
                              <Button
                                type="button"
                                variant={field.value === "LATE" ? "default" : "ghost"}
                                className="flex-1"
                                onClick={() => field.onChange("LATE")}
                                disabled={isClosureMode}
                                data-testid="button-report-type-late"
                              >
                                遅刻
                              </Button>
                            </div>
                          </FormControl>
                          {isClosureMode && (
                            <p className="text-xs text-muted-foreground">休講コード適用中は欠席のみ選択できます。</p>
                          )}
                          {field.value === "LATE" && (
                            <p className="text-xs text-muted-foreground">遅刻連絡では振替予約はできません。</p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="space-y-3">
                      {fields.map((field, index) => {
                        const row = watchedItems?.[index];
                        const rowKey = getSlotCacheKey(row?.absentDateISO, row?.declaredClassBand);
                        const isLoadingRowSlots = rowKey ? loadingSlotKeys.has(rowKey) : false;
                        const rowSlotOptions = isClosureMode
                          ? getClosureRowSlotOptions(row)
                          : (rowKey ? (slotOptionsByKey[rowKey] || []) : []);
                        const selectableOptions = isClosureMode
                          ? rowSlotOptions
                          : rowSlotOptions.filter((slot) => !slot.isPastLesson);

                        return (
                          <div key={field.id} className="border rounded-lg p-4 space-y-4">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-semibold text-muted-foreground">お子様 {index + 1}</p>
                              {fields.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveRow(index)}
                                  data-testid={`button-remove-row-${index}`}
                                >
                                  <Trash2Icon className="w-4 h-4 mr-1" />
                                  行を削除
                                </Button>
                              )}
                            </div>

                            <FormField
                              control={absenceForm.control}
                              name={`items.${index}.childName` as const}
                              render={({ field: itemField }) => (
                                <FormItem>
                                  <FormLabel>
                                    お子様の名前
                                    <span className="ml-1 text-xs font-normal text-muted-foreground">（ひらがなで入力）</span>
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      {...itemField}
                                      placeholder="例：やまだ たろう"
                                      pattern="[ぁ-ゖー 　]+"
                                      className="h-12"
                                      data-testid={`input-child-name-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <FormField
                                control={absenceForm.control}
                                name={`items.${index}.declaredClassBand` as const}
                                render={({ field: itemField }) => (
                                  <FormItem>
                                    <FormLabel>クラス帯</FormLabel>
                                    <Select
                                      value={itemField.value}
                                      onValueChange={(value) => handleRowClassBandChange(index, value as "初級" | "中級" | "上級")}
                                    >
                                      <FormControl>
                                        <SelectTrigger className="h-12" data-testid={`select-class-band-${index}`}>
                                          <SelectValue placeholder="クラス帯を選択" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {CLASS_BANDS.map((band) => (
                                          <SelectItem key={band} value={band}>
                                            {band}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={absenceForm.control}
                                name={`items.${index}.absentDateISO` as const}
                                render={({ field: itemField }) => (
                                  <FormItem className="w-full min-w-0">
                                    <FormLabel>欠席予定日</FormLabel>
                                    <FormControl>
                                      <div className="relative w-full min-w-0 rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                                        <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
                                        <Input
                                          type="date"
                                          value={itemField.value || ""}
                                          onChange={(event) => handleRowDateChange(index, event.target.value)}
                                          className="absence-date-input h-12 w-full min-w-0 max-w-full border-0 bg-transparent pl-10 pr-2 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                                          data-testid={`input-absent-date-${index}`}
                                        />
                                      </div>
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <FormField
                              control={absenceForm.control}
                              name={`items.${index}.originalSlotId` as const}
                              render={({ field: itemField }) => (
                                <FormItem>
                                  <FormLabel>欠席するレッスン枠</FormLabel>
                                  <Select
                                    value={itemField.value || ""}
                                    onValueChange={(value) => handleRowOriginalSlotChange(index, value)}
                                    disabled={!row?.absentDateISO || !row?.declaredClassBand}
                                  >
                                    <FormControl>
                                      <SelectTrigger className="h-12" data-testid={`select-original-slot-${index}`}>
                                        <SelectValue placeholder={
                                          !row?.absentDateISO || !row?.declaredClassBand
                                            ? "先に欠席日とクラス帯を選択"
                                            : "レッスン枠を選択"
                                        } />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {selectableOptions.map((slot) => (
                                        <SelectItem key={slot.id} value={slot.id}>
                                          {slot.startTime} - {slot.courseLabel}（{slot.classBand}）
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {!isClosureMode && isLoadingRowSlots && (
                                    <p className="text-xs text-muted-foreground mt-1">レッスン枠を読み込み中です...</p>
                                  )}
                                  {!isClosureMode &&
                                    !isLoadingRowSlots &&
                                    row?.absentDateISO &&
                                    row?.declaredClassBand &&
                                    selectableOptions.length === 0 && (
                                      <p className="text-sm text-destructive mt-1">
                                        この日の{row.declaredClassBand}クラスのレッスンはありません
                                      </p>
                                    )}
                                  <p className="text-xs text-muted-foreground mt-2">
                                    {selectedReportType === "LATE"
                                      ? "遅刻連絡はレッスン開始前までに登録してください。"
                                      : "欠席連絡はレッスン開始時刻までです。開始後は振替登録できません。"}
                                  </p>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        );
                      })}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddRow}
                      className="w-full"
                      data-testid="button-add-row"
                    >
                      <PlusIcon className="w-4 h-4 mr-2" />
                      子どもを追加（最大5名）
                    </Button>

                    {!isOptionalSectionOpen && (
                      <div className="space-y-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-start"
                          onClick={() => openOptionalAndFocus("reason")}
                          data-testid="button-open-optional-reason"
                        >
                          理由（任意）
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-start"
                          onClick={() => openOptionalAndFocus("contactEmail")}
                          data-testid="button-open-optional-contact-email"
                        >
                          通知用メールアドレス（任意）
                        </Button>
                      </div>
                    )}

                    <Collapsible open={isOptionalSectionOpen} onOpenChange={setOptionalOpen}>
                      <CollapsibleContent className="space-y-4 pt-4">
                        <FormField
                          control={absenceForm.control}
                          name="reason"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                理由
                                <span className="text-muted-foreground text-xs ml-2">（任意）</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  ref={(element) => {
                                    field.ref(element);
                                    reasonInputRef.current = element;
                                  }}
                                  type="text"
                                  maxLength={200}
                                  placeholder="例: 体調不良"
                                  className="h-12"
                                  data-testid="input-absence-reason"
                                />
                              </FormControl>
                              <p className="text-xs text-muted-foreground">
                                200文字以内で入力できます
                              </p>
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
                                  ref={(element) => {
                                    field.ref(element);
                                    contactEmailInputRef.current = element;
                                  }}
                                  type="email"
                                  placeholder="example@email.com"
                                  className="h-12"
                                  data-testid="input-contact-email"
                                />
                              </FormControl>
                              <p className="text-xs text-muted-foreground">
                                {isEmailNoticeActive
                                  ? EMAIL_FIELD_NOTICE_MESSAGE
                                  : `入力すると確認コードと${isLateReport ? "遅刻" : "欠席"}完了通知がメールで届きます`}
                              </p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full"
                          onClick={() => setOptionalOpen(false)}
                          data-testid="button-close-optional-fields"
                        >
                          任意項目を閉じる
                        </Button>
                      </CollapsibleContent>
                    </Collapsible>

                    <Button
                      type="submit"
                      className="w-full h-12 text-base font-semibold"
                      disabled={absenceForm.formState.isSubmitting}
                      data-testid="button-submit-absence-batch"
                    >
                      {absenceForm.formState.isSubmitting
                        ? "登録中..."
                        : isClosureMode
                          ? "休講振替権を登録"
                          : isLateReport
                            ? "遅刻連絡を登録"
                            : "欠席連絡を登録"}
                    </Button>

                    {!token && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                        <div className="flex items-center gap-2 text-amber-900">
                          <AlertTriangleIcon className="w-4 h-4" />
                          <p className="font-semibold text-sm">臨時休講等による振替が必要な場合</p>
                        </div>

                        {!closureValidation ? (
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                              value={closureCode}
                              onChange={(event) => setClosureCode(event.target.value)}
                              placeholder="共通コードを入力"
                              className="h-10"
                              data-testid="input-closure-code"
                            />
                            <Button
                              type="button"
                              onClick={handleValidateClosureCode}
                              disabled={isValidatingClosureCode}
                              className="sm:w-40"
                              data-testid="button-validate-closure-code"
                            >
                              {isValidatingClosureCode ? "確認中..." : "コード確認"}
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-2 text-sm">
                            <p>
                              <span className="font-semibold">イベント:</span> {closureValidation.name}
                            </p>
                            <p>
                              <span className="font-semibold">残り利用回数:</span> {closureValidation.usageRemaining} / {closureValidation.usageLimit}
                            </p>
                            <p>
                              <span className="font-semibold">有効期限:</span> {closureValidation.expiresAt}
                            </p>
                            <div className="flex gap-2 pt-1">
                              <Badge variant="secondary">休講コード適用中</Badge>
                              <Button type="button" variant="outline" size="sm" onClick={clearClosureMode} data-testid="button-clear-closure-mode">
                                通常欠席に戻す
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
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
            isAbsenceCancelled(absenceData.makeupStatus) ? (
              <Card className="border-2 bg-muted/40">
                <CardContent className="p-12 text-center text-muted-foreground">
                  この{getReportTypeLabel(absenceData.reportType)}連絡はキャンセル済みです。新しい連絡を登録してください。
                </CardContent>
              </Card>
            ) : absenceData.reportType === "LATE" ? (
              <Card className="border-2 bg-muted/40">
                <CardContent className="p-12 text-center text-muted-foreground">
                  遅刻連絡では振替予約はできません。レッスンへそのままお越しください。
                </CardContent>
              </Card>
            ) : absenceData.makeupStatus === "MAKEUP_CONFIRMED" ? (
              <Card className="border-2 bg-muted/40">
                <CardContent className="p-12 text-center text-muted-foreground">
                  すでに振替予約が確定済みです。振替後の変更は「予約確認」のページからできます。
                </CardContent>
              </Card>
            ) : !isMakeupDeadlineOpen(absenceData.makeupDeadline) ? (
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

        {searchParams2 && canSearchMakeup && (
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
                            hasSlots: slots.map(s => parseJstDate(formatJstDate(s.date))),
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
                              .filter(s => formatJstDate(s.date) === formatJstDate(selectedDate))
                              .map(slot => (
                                <SlotCard
                                  key={slot.slotId}
                                  slot={slot}
                                  onBook={handleBook}
                                  absenceId={absenceData?.id}
                                />
                              ))
                            }
                            {slots.filter(s => formatJstDate(s.date) === formatJstDate(selectedDate)).length === 0 && (
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

        <section className="rounded-lg border bg-muted/30 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            不具合を見つけた場合は、こちらのフォームからご報告ください。
          </p>
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSd4XbZOevZtBujfElYwwQ2RzFJsA0Jp2vlE05BYO-POLpBafw/viewform?usp=header"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-primary underline underline-offset-4"
            data-testid="link-bug-report-form"
          >
            バグ報告フォームを開く
          </a>
        </section>
      </main>


      <Dialog open={showConfirmCodeDialog} onOpenChange={setShowConfirmCodeDialog} modal={false}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">
              {confirmItems[0] ? `${getReportTypeLabel(confirmItems[0].reportType)}連絡を受け付けました` : "連絡を受け付けました"}
            </DialogTitle>
            <DialogDescription className="text-center">
              子どもごとの確認コードと再開リンクです。<br />
              必ず保存してください。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {confirmItems.map((item, index) => {
              const resumeUrl = buildResumeUrl(item.resumeToken);
              return (
                <div key={`${item.absenceId}-${index}`} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{item.childName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.absentDateISO} / {item.declaredClassBand} / {getReportTypeLabel(item.reportType)}
                      </p>
                    </div>
                    <span className="text-2xl font-bold tracking-[0.2em] font-mono text-primary" data-testid={`text-confirm-code-${index}`}>
                      {item.confirmCode}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground break-all">
                    連絡詳細リンク: <a href={`/?token=${item.resumeToken}`} className="underline">{resumeUrl}</a>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => copyText(item.confirmCode, `${item.childName}さんの確認コードをコピーしました。`)}
                      data-testid={`button-copy-code-${index}`}
                    >
                      <CopyIcon className="w-4 h-4 mr-2" />
                      コードをコピー
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => copyText(resumeUrl, `${item.childName}さんの連絡詳細リンクをコピーしました。`)}
                      data-testid={`button-copy-link-${index}`}
                    >
                      <CopyIcon className="w-4 h-4 mr-2" />
                      リンクをコピー
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800 w-full">
            <p className="font-semibold mb-1">重要</p>
            <ul className="list-disc list-inside space-y-1">
              <li>確認コードはスクリーンショットやメモで保存してください</li>
              <li>「予約確認」ページからコードを入力すると予約状況を確認できます</li>
              <li>{isEmailNoticeActive ? EMAIL_CONFIRM_NOTICE_MESSAGE : "メールアドレスを入力した場合は、メールでも確認コードが届きます"}</li>
            </ul>
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
  const actualCurrent = slot.actualCurrent ?? getActualCurrent({
    capacityLimit: slot.capacityLimit,
    capacityCurrent: slot.capacityCurrent,
    capacityMakeupUsed: slot.capacityMakeupUsed,
  });
  const actualRemainingSlots = slot.remainingSlots ?? getRemainingCapacity({
    capacityLimit: slot.capacityLimit,
    capacityCurrent: slot.capacityCurrent,
    capacityMakeupUsed: slot.capacityMakeupUsed,
  });

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
            <p className="font-semibold">{actualCurrent}</p>
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

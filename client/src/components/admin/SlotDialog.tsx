import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClassSlot, Course } from "@shared/schema";
import { formatJstDate } from "@shared/jst";

export type SlotDialogProps = {
    slot: ClassSlot | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: any) => void;
};

export function SlotDialog({ slot, open, onOpenChange, onSave }: SlotDialogProps) {
    const [classBandCapacities, setClassBandCapacities] = useState<Record<string, any>>({});
    const { data: courses = [] } = useQuery<Course[]>({
        queryKey: ["/api/admin/courses"],
    });

    const form = useForm({
        resolver: zodResolver(
            z.object({
                courseId: z.string().optional(),
                date: z.string().min(1, "日付を選択してください"),
                startTime: z.string().min(1, "開始時刻を入力してください"),
                courseLabel: z.string().min(1, "コース名を入力してください"),
                classBands: z.array(z.enum(["初級", "中級", "上級"])).min(1, "少なくとも1つのクラス帯を選択してください"),
                isRecurring: z.boolean().optional(),
                recurringWeeks: z.number().min(1).max(52).optional(),
                applyToFuture: z.boolean().optional(),
            })
        ),
        defaultValues: slot
            ? {
                courseId: "",
                date: formatJstDate(slot.date),
                startTime: slot.startTime,
                courseLabel: slot.courseLabel,
                classBands: [slot.classBand],
                isRecurring: false,
                recurringWeeks: 12,
                applyToFuture: false,
            }
            : {
                courseId: "",
                date: "",
                startTime: "10:00",
                courseLabel: "",
                classBands: [],
                isRecurring: false,
                recurringWeeks: 12,
                applyToFuture: false,
            },
    });

    const handleCourseSelect = (courseId: string) => {
        const selected = courses.find(c => c.id === courseId);
        if (selected) {
            form.setValue("courseId", courseId);
            form.setValue("courseLabel", selected.name);
            form.setValue("startTime", selected.startTime);
        }
    };

    // 編集時の初期値設定
    useEffect(() => {
        if (slot) {
            const initialCapacities = {
                [slot.classBand]: {
                    capacityLimit: slot.capacityLimit,
                    capacityCurrent: slot.capacityCurrent,
                }
            };
            setClassBandCapacities(initialCapacities);
            form.reset({
                date: formatJstDate(slot.date),
                startTime: slot.startTime,
                courseLabel: slot.courseLabel,
                classBands: [slot.classBand],
                isRecurring: false,
                recurringWeeks: 12,
                applyToFuture: false,
            });
        } else {
            setClassBandCapacities({});
            form.reset({
                date: "",
                startTime: "10:00",
                courseLabel: "",
                classBands: [],
                isRecurring: false,
                recurringWeeks: 12,
                applyToFuture: false,
            });
        }
    }, [slot, open]);

    const selectedBands = form.watch("classBands") || [];

    // クラス帯が選択されたときにデフォルト値を設定
    const handleClassBandChange = (band: string, checked: boolean) => {
        if (checked && !classBandCapacities[band]) {
            const defaultLimit = 10;
            const defaultCurrent = 0;
            setClassBandCapacities({
                ...classBandCapacities,
                [band]: {
                    capacityLimit: defaultLimit,
                    capacityCurrent: defaultCurrent,
                }
            });
        }
    };

    const handleSubmit = (data: any) => {
        // クラス帯ごとの設定を含めて送信
        onSave({
            ...data,
            classBandCapacities,
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-xl">
                        {slot ? "枠を編集" : "新しい枠を作成"}
                    </DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                        {!slot && courses.length > 0 && (
                            <FormField
                                control={form.control}
                                name="courseId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>登録済みコースから選択（省略可）</FormLabel>
                                        <Select onValueChange={handleCourseSelect} value={field.value || ""}>
                                            <FormControl>
                                                <SelectTrigger data-testid="select-slot-course">
                                                    <SelectValue placeholder="コースを選択すると自動入力されます" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {courses.map((course) => (
                                                    <SelectItem key={course.id} value={course.id}>
                                                        {course.name} ({course.dayOfWeek} {course.startTime})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="date"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>日付</FormLabel>
                                        <FormControl>
                                            <Input {...field} type="date" data-testid="input-slot-date" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="startTime"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>開始時刻</FormLabel>
                                        <FormControl>
                                            <Input {...field} type="time" data-testid="input-slot-time" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="courseLabel"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>コース名</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            placeholder="例：月曜10時コース"
                                            data-testid="input-slot-courselabel"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="classBands"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{slot ? "クラス帯" : "クラス帯（複数選択可）"}</FormLabel>
                                    {slot && (
                                        <p className="text-xs text-muted-foreground mb-2">
                                            ※編集モードではクラス帯の変更はできません
                                        </p>
                                    )}
                                    <div className="space-y-2">
                                        {["初級", "中級", "上級"].map((band) => (
                                            <div key={band} className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    id={`band-${band}`}
                                                    checked={field.value?.includes(band as any)}
                                                    disabled={!!slot}
                                                    onChange={(e) => {
                                                        const currentValue = field.value || [];
                                                        if (e.target.checked) {
                                                            field.onChange([...currentValue, band]);
                                                            handleClassBandChange(band, true);
                                                        } else {
                                                            field.onChange(currentValue.filter((v: string) => v !== band));
                                                        }
                                                    }}
                                                    className="h-4 w-4 rounded border-gray-300"
                                                    data-testid={`checkbox-band-${band}`}
                                                />
                                                <label htmlFor={`band-${band}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                                    {band}
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {selectedBands.length > 0 && (
                            <div className="space-y-4 border-t pt-4">
                                <h3 className="font-semibold text-sm">各クラス帯の定員設定</h3>
                                {selectedBands.map((band) => (
                                    <div key={band} className="border rounded-lg p-4 space-y-3">
                                        <h4 className="font-medium text-sm">{band}</h4>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <Label className="text-xs mb-1 block">定員</Label>
                                                <Input
                                                    type="number"
                                                    value={classBandCapacities[band]?.capacityLimit ?? ''}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        const newLimit = value === '' ? 0 : parseInt(value);
                                                        const current = classBandCapacities[band]?.capacityCurrent ?? 0;
                                                        setClassBandCapacities(prev => ({
                                                            ...prev,
                                                            [band]: {
                                                                capacityLimit: newLimit,
                                                                capacityCurrent: current,
                                                            },
                                                        }));
                                                    }}
                                                    data-testid={`input-${band}-capacitylimit`}
                                                    className="h-9"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs mb-1 block">現在の参加者数</Label>
                                                <Input
                                                    type="number"
                                                    value={classBandCapacities[band]?.capacityCurrent ?? ''}
                                                    onChange={(e) => {
                                                        const value = e.target.value;
                                                        const newCurrent = value === '' ? 0 : parseInt(value);
                                                        const limit = classBandCapacities[band]?.capacityLimit ?? 0;
                                                        setClassBandCapacities(prev => ({
                                                            ...prev,
                                                            [band]: {
                                                                capacityLimit: limit,
                                                                capacityCurrent: newCurrent,
                                                            },
                                                        }));
                                                    }}
                                                    data-testid={`input-${band}-capacitycurrent`}
                                                    className="h-9"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-xs mb-1 block">振替可能枠（自動計算）</Label>
                                                <Input
                                                    type="number"
                                                    value={Math.max(0, (classBandCapacities[band]?.capacityLimit ?? 0) - (classBandCapacities[band]?.capacityCurrent ?? 0))}
                                                    disabled
                                                    data-testid={`input-${band}-capacitymakeupallowed`}
                                                    className="h-9 bg-muted"
                                                />
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    定員 - 現在の参加者数
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {!slot && (
                            <div className="border-t pt-4 mt-2">
                                <FormField
                                    control={form.control}
                                    name="isRecurring"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                            <FormControl>
                                                <input
                                                    type="checkbox"
                                                    checked={field.value}
                                                    onChange={field.onChange}
                                                    className="mt-1"
                                                    data-testid="checkbox-recurring"
                                                />
                                            </FormControl>
                                            <div className="space-y-1 leading-none">
                                                <FormLabel className="font-semibold">
                                                    毎週繰り返し作成
                                                </FormLabel>
                                                <p className="text-sm text-muted-foreground">
                                                    この枠を毎週同じ曜日・時間に自動作成します
                                                </p>
                                            </div>
                                        </FormItem>
                                    )}
                                />

                                {form.watch("isRecurring") && (
                                    <FormField
                                        control={form.control}
                                        name="recurringWeeks"
                                        render={({ field }) => (
                                            <FormItem className="mt-4">
                                                <FormLabel>作成する週数</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        type="number"
                                                        min="1"
                                                        max="52"
                                                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                                                        data-testid="input-recurring-weeks"
                                                    />
                                                </FormControl>
                                                <p className="text-xs text-muted-foreground">
                                                    {field.value}週間分の枠を作成します
                                                </p>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </div>
                        )}

                        {slot && (
                            <div className="border-t pt-4 mt-2">
                                <FormField
                                    control={form.control}
                                    name="applyToFuture"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                            <FormControl>
                                                <input
                                                    type="checkbox"
                                                    checked={field.value}
                                                    onChange={field.onChange}
                                                    className="mt-1"
                                                    data-testid="checkbox-apply-to-future"
                                                />
                                            </FormControl>
                                            <div className="space-y-1 leading-none">
                                                <FormLabel className="font-semibold">
                                                    この日以降すべての同一コースに適用
                                                </FormLabel>
                                                <p className="text-sm text-muted-foreground">
                                                    同じ曜日・時間・クラス帯のコースすべてに人数設定を適用します
                                                </p>
                                            </div>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                data-testid="button-cancel-slot"
                            >
                                キャンセル
                            </Button>
                            <Button type="submit" data-testid="button-save-slot">
                                {slot ? "更新" : "作成"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

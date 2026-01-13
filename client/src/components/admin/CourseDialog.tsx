import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCourseRequestSchema } from "@shared/schema";
import type { Course } from "@shared/schema";
import { DAY_OPTIONS, HOUR_OPTIONS, MINUTE_OPTIONS } from "./types";

const courseFormSchema = createCourseRequestSchema.extend({
    startHour: z.string().min(1, "時間を選択してください"),
    startMinute: z.string().min(1, "分を選択してください"),
});

export type CourseDialogProps = {
    course: Course | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: { name: string; dayOfWeek: string; startTime: string }) => void;
};

export function CourseDialog({ course, open, onOpenChange, onSave }: CourseDialogProps) {
    const form = useForm({
        resolver: zodResolver(courseFormSchema),
        defaultValues: {
            name: course?.name || "",
            dayOfWeek: course?.dayOfWeek || "",
            startTime: course?.startTime || "",
            startHour: course?.startTime?.split(":")[0] || "09",
            startMinute: course?.startTime?.split(":")[1] || "00",
        },
    });

    const startHour = form.watch("startHour");
    const startMinute = form.watch("startMinute");

    useEffect(() => {
        if (course) {
            const hour = course.startTime.split(":")[0];
            const minute = course.startTime.split(":")[1];
            form.reset({
                name: course.name,
                dayOfWeek: course.dayOfWeek,
                startTime: course.startTime,
                startHour: hour,
                startMinute: minute,
            });
        } else {
            form.reset({ name: "", dayOfWeek: "", startTime: "", startHour: "09", startMinute: "00" });
        }
    }, [course, form]);

    useEffect(() => {
        if (startHour && startMinute) {
            const combinedTime = `${startHour}:${startMinute}`;
            form.setValue("startTime", combinedTime);
        }
    }, [startHour, startMinute, form]);

    const onSubmit = (data: { name: string; dayOfWeek: string; startTime: string }) => {
        onSave(data);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{course ? "コースを編集" : "新しいコースを追加"}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>コース名</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            placeholder="例: 月曜16時クラス"
                                            data-testid="input-course-name"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="dayOfWeek"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>曜日</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger data-testid="select-course-day">
                                                <SelectValue placeholder="曜日を選択" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {DAY_OPTIONS.map((day) => (
                                                <SelectItem key={day} value={day}>
                                                    {day}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="startHour"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>時間</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger data-testid="select-course-hour">
                                                    <SelectValue placeholder="時を選択" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {HOUR_OPTIONS.map((hour) => (
                                                    <SelectItem key={hour} value={hour}>
                                                        {hour}時
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="startMinute"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>分</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger data-testid="select-course-minute">
                                                    <SelectValue placeholder="分を選択" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {MINUTE_OPTIONS.map((minute) => (
                                                    <SelectItem key={minute} value={minute}>
                                                        {minute}分
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                data-testid="button-cancel-course"
                            >
                                キャンセル
                            </Button>
                            <Button type="submit" data-testid="button-save-course">
                                {course ? "更新" : "作成"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

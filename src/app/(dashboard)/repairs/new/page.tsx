'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wrench, ArrowLeft, Store } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  Input,
  Textarea,
  Select,
  Button,
  EmptyState,
  toast,
} from '@/components/ui';
import { RepairPhotoInput } from '@/components/repairs/repair-photo-input';
import { useAppStore } from '@/stores/app-store';

export default function NewRepairPage() {
  const router = useRouter();
  const { currentStoreId } = useAppStore();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!currentStoreId) {
    return (
      <EmptyState
        icon={Store}
        title="ยังไม่ได้เลือกสาขา"
        description="กรุณาเลือกสาขาก่อนแจ้งซ่อม"
      />
    );
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast({ type: 'error', title: 'กรุณาระบุหัวข้อการแจ้งซ่อม' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: currentStoreId,
          title: title.trim(),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          priority,
          photoUrls,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'แจ้งซ่อมไม่สำเร็จ');
      toast({ type: 'success', title: 'แจ้งซ่อมเรียบร้อย', message: 'ส่งเรื่องให้ช่างแล้ว' });
      router.push('/repairs');
    } catch (err) {
      toast({
        type: 'error',
        title: 'เกิดข้อผิดพลาด',
        message: err instanceof Error ? err.message : 'แจ้งซ่อมไม่สำเร็จ',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/repairs"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
          <Wrench className="h-5 w-5 text-orange-500" />
          แจ้งซ่อมอุปกรณ์
        </h1>
      </div>

      <Card padding="none">
        <CardHeader title="รายละเอียดการแจ้งซ่อม" description="แจ้งอุปกรณ์ที่เสียในสาขาของคุณ" />
        <CardContent className="space-y-4">
          <Input
            label="อุปกรณ์ / หัวข้อที่เสีย"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="เช่น แอร์ห้องครัวไม่เย็น"
          />
          <Input
            label="จุดที่ตั้ง / ตำแหน่ง"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="เช่น หลังบาร์, ห้องน้ำชาย"
          />
          <Textarea
            label="รายละเอียดอาการเสีย"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="อธิบายอาการที่พบ"
          />
          <Select
            label="ความเร่งด่วน"
            value={priority}
            onChange={(e) => setPriority(e.target.value as 'normal' | 'urgent')}
            options={[
              { value: 'normal', label: 'ปกติ' },
              { value: 'urgent', label: 'เร่งด่วน' },
            ]}
          />
          <RepairPhotoInput
            label="รูปอุปกรณ์ที่เสีย"
            value={photoUrls}
            onChange={setPhotoUrls}
            folder="repair-before"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/repairs">
              <Button variant="ghost" type="button">
                ยกเลิก
              </Button>
            </Link>
            <Button
              variant="primary"
              onClick={handleSubmit}
              isLoading={submitting}
              icon={<Wrench className="h-4 w-4" />}
            >
              ส่งแจ้งซ่อม
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

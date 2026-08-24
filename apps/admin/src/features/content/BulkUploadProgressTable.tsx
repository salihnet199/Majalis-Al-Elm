import React, { useMemo } from 'react';
import { Table, Tag, Progress, Button, Tooltip, Typography } from 'antd';
import {
  ReloadOutlined,
  StopOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { BulkItem, BulkItemStatus } from '../../core/api/bulkUploadQueue';
import { formatBytesAr } from '../../core/api/mediaUpload';

const { Text } = Typography;

// ── Status display config ─────────────────────────────────────────────────────

interface StatusConfig {
  color: string;
  icon: React.ReactNode;
  label: string;
}

const STATUS_CONFIG: Record<BulkItemStatus, StatusConfig> = {
  QUEUED: {
    color: 'default',
    icon: <ClockCircleOutlined />,
    label: 'في الانتظار',
  },
  HASHING: {
    color: 'processing',
    icon: <LoadingOutlined spin />,
    label: 'جاري الحساب',
  },
  UPLOADING: {
    color: 'processing',
    icon: <LoadingOutlined spin />,
    label: 'يُرفع',
  },
  VERIFYING: {
    color: 'processing',
    icon: <LoadingOutlined spin />,
    label: 'جاري التحقق',
  },
  DONE: {
    color: 'success',
    icon: <CheckCircleOutlined />,
    label: 'تم بنجاح',
  },
  FAILED: {
    color: 'error',
    icon: <CloseCircleOutlined />,
    label: 'فشل',
  },
};

// ── Progress cell ─────────────────────────────────────────────────────────────

function ProgressCell({ item }: { item: BulkItem }): React.ReactElement {
  if (item.status === 'DONE') {
    return (
      <Progress percent={100} size="small" status="success" showInfo={false} />
    );
  }

  if (item.status === 'FAILED') {
    return (
      <Tooltip title={item.error ?? 'خطأ غير محدد'}>
        <Progress percent={0} size="small" status="exception" showInfo={false} />
      </Tooltip>
    );
  }

  if (item.status === 'QUEUED') {
    return (
      <Progress percent={0} size="small" status="normal" showInfo={false} />
    );
  }

  const percent = item.progress?.percent ?? 0;
  const phaseLabel =
    item.status === 'HASHING'
      ? 'تجهيز'
      : item.status === 'VERIFYING'
        ? 'تحقق'
        : `${percent}%`;

  return (
    <Progress
      percent={percent}
      size="small"
      status="active"
      format={() => phaseLabel}
    />
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface BulkUploadProgressTableProps {
  items: BulkItem[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const BulkUploadProgressTable: React.FC<BulkUploadProgressTableProps> = ({
  items,
  onRetry,
  onCancel,
}) => {
  const columns = useMemo(
    () => [
      {
        title: 'اسم الملف',
        dataIndex: ['file', 'name'],
        key: 'name',
        ellipsis: true,
        render: (_: string, record: BulkItem) => (
          <Tooltip title={record.file.name}>
            <Text
              className="font-mono text-xs text-slate-200"
              style={{ maxWidth: 220, display: 'block' }}
              ellipsis
            >
              {record.file.name}
            </Text>
          </Tooltip>
        ),
      },
      {
        title: 'الحجم',
        key: 'size',
        width: 100,
        render: (_: unknown, record: BulkItem) => (
          <Text className="text-xs text-slate-400 font-mono">
            {formatBytesAr(record.file.size)}
          </Text>
        ),
      },
      {
        title: 'الحالة',
        key: 'status',
        width: 130,
        render: (_: unknown, record: BulkItem) => {
          const cfg = STATUS_CONFIG[record.status];
          return (
            <Tag
              color={cfg.color}
              icon={cfg.icon}
              className="font-medium text-xs"
            >
              {cfg.label}
              {record.retryCount > 0 ? ` (محاولة ${record.retryCount + 1})` : ''}
            </Tag>
          );
        },
      },
      {
        title: 'التقدم',
        key: 'progress',
        width: 180,
        render: (_: unknown, record: BulkItem) => (
          <ProgressCell item={record} />
        ),
      },
      {
        title: '',
        key: 'actions',
        width: 80,
        render: (_: unknown, record: BulkItem) => {
          if (record.status === 'FAILED') {
            return (
              <Tooltip title="أعِد المحاولة">
                <Button
                  id={`bulk-retry-${record.id}`}
                  type="text"
                  size="small"
                  icon={<ReloadOutlined className="text-emerald-400" />}
                  onClick={() => onRetry(record.id)}
                />
              </Tooltip>
            );
          }

          const isActive =
            record.status === 'HASHING' ||
            record.status === 'UPLOADING' ||
            record.status === 'VERIFYING';

          if (isActive) {
            return (
              <Tooltip title="إلغاء">
                <Button
                  id={`bulk-cancel-${record.id}`}
                  type="text"
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  onClick={() => onCancel(record.id)}
                />
              </Tooltip>
            );
          }

          return null;
        },
      },
    ],
    [onRetry, onCancel],
  );

  return (
    <Table<BulkItem>
      dataSource={items}
      columns={columns}
      rowKey="id"
      size="small"
      pagination={false}
      scroll={{ y: 480 }}
      locale={{ emptyText: 'اسحب الملفات هنا أو اضغط "اختر ملفات" للبدء' }}
      rowClassName={(record) =>
        record.status === 'FAILED' ? 'bg-red-950/20' : ''
      }
    />
  );
};

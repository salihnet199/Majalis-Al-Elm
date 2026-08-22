import React, { useState } from 'react';
import { Table, Card, Typography, Tag, Drawer, Button, Input, Select } from 'antd';
import { EyeOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { queryKeys } from '../../core/queries/queryKeys';
import { AuditLogItem } from '../../core/types/audit.types';

const { Title, Text } = Typography;
const { Option } = Select;

export const AuditLogsScreen: React.FC = () => {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.auditLogs.list({ search, action: actionFilter, page: currentPage, limit: pageSize }),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (actionFilter !== 'ALL') params.append('action', actionFilter);
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const res = await apiClient.get(`/admin/audit-log?${params.toString()}`);
      return {
        items: (res.data?.data || res.data || []) as AuditLogItem[],
        total: res.data?.meta?.total || 0,
      };
    },
    staleTime: 15000,
  });

  const columns = [
    {
      title: 'الوقت والتاريخ',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: string) => (
        <span className="text-xs text-slate-400 font-mono">
          {date ? new Date(date).toLocaleString('ar-SA') : '—'}
        </span>
      ),
    },
    {
      title: 'المسؤول المنفذ (Actor)',
      key: 'actor',
      width: 200,
      render: (_: unknown, record: AuditLogItem) => (
        <div>
          <div className="font-bold text-slate-200 text-xs">{record.actor?.name || 'System'}</div>
          <Tag color="blue" className="text-[10px] mt-0.5">
            {record.actor?.role || 'System'}
          </Tag>
        </div>
      ),
    },
    {
      title: 'نوع الإجراء (Action)',
      dataIndex: 'action',
      key: 'action',
      width: 200,
      render: (action: string) => {
        const isDangerous = action.includes('delete') || action.includes('suspend') || action.includes('role');
        return (
          <Tag color={isDangerous ? 'error' : 'processing'} className="font-mono text-xs">
            {action}
          </Tag>
        );
      },
    },
    {
      title: 'الكيان المستهدف (Entity)',
      key: 'entity',
      render: (_: unknown, record: AuditLogItem) => (
        <span className="text-xs text-slate-300 font-mono">
          {record.entityType}:{record.entityId?.slice(0, 13)}...
        </span>
      ),
    },
    {
      title: 'عنوان IP',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 130,
      render: (ip: string) => (
        <span className="text-xs text-slate-400 font-mono">{ip || '127.0.0.1'}</span>
      ),
    },
    {
      title: 'التفاصيل',
      key: 'details',
      width: 100,
      render: (_: unknown, record: AuditLogItem) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => setSelectedLog(record)}
        >
          معاينة
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title level={3} className="!text-slate-100 !mb-1 font-bold">
            سجل تدقيق العمليات الأمنية (Audit Logs)
          </Title>
          <Text className="text-slate-400 text-sm">
            تتبع كامل وغير قابل للتعديل لجميع العمليات الإدارية الحساسة وتغييرات النظام
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => refetch()}
          className="rounded-lg"
        >
          تحديث السجل
        </Button>
      </div>

      {/* Filters Bar */}
      <Card className="rounded-xl border border-slate-700/60 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            placeholder="البحث بالمسؤول أو المعرف..."
            prefix={<SearchOutlined className="text-slate-500" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            className="rounded-lg"
          />
          <Select
            value={actionFilter}
            onChange={(val) => setActionFilter(val)}
            className="w-full rounded-lg"
          >
            <Option value="ALL">جميع العمليات</Option>
            <Option value="user.suspend">تجميد حساب (user.suspend)</Option>
            <Option value="user.role_change">تغيير دور (user.role_change)</Option>
            <Option value="content.create">إنشاء محتوى (content.create)</Option>
            <Option value="content.delete">حذف محتوى (content.delete)</Option>
          </Select>
        </div>
      </Card>

      {/* Audit Table */}
      <Card className="rounded-xl border border-slate-700/60 shadow-sm">
        <Table
          dataSource={data?.items || []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: data?.total || 0,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
            showSizeChanger: true,
            pageSizeOptions: ['15', '30', '50'],
          }}
          locale={{ emptyText: 'لا توجد سجلات تدقيق حالياً' }}
        />
      </Card>

      {/* Diff Inspector Drawer */}
      <Drawer
        title={<span className="font-bold">تفاصيل العملية وتغييرات الحالة (Diff Inspector)</span>}
        placement="left"
        width={550}
        onClose={() => setSelectedLog(null)}
        open={!!selectedLog}
      >
        {selectedLog && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-800 rounded-lg border border-slate-700 text-xs space-y-1">
              <div><span className="text-slate-400">معرف العملية:</span> <span className="font-mono text-emerald-400">{selectedLog.id}</span></div>
              <div><span className="text-slate-400">الإجراء:</span> <span className="font-bold text-slate-200">{selectedLog.action}</span></div>
              <div><span className="text-slate-400">المنفذ:</span> <span className="text-slate-200">{selectedLog.actor?.name} ({selectedLog.actor?.role})</span></div>
              <div><span className="text-slate-400">الوقت:</span> <span className="font-mono text-slate-300">{new Date(selectedLog.createdAt).toLocaleString('ar-SA')}</span></div>
            </div>

            <div>
              <div className="text-xs font-bold text-slate-300 mb-1">الحالة السابقة (Old Value):</div>
              <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto">
                {JSON.stringify(selectedLog.oldValue, null, 2) || 'null'}
              </pre>
            </div>

            <div>
              <div className="text-xs font-bold text-slate-300 mb-1">الحالة الجديدة (New Value):</div>
              <pre className="p-3 bg-slate-950 rounded-lg border border-emerald-900/60 text-[11px] font-mono text-emerald-400 overflow-x-auto">
                {JSON.stringify(selectedLog.newValue, null, 2) || 'null'}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
};

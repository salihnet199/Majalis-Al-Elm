import React, { useState } from 'react';
import {
  Card,
  Tabs,
  Table,
  Button,
  Input,
  Tag,
  Switch,
  Modal,
  Form,
  Select,
  Typography,
  message,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  EditOutlined,
  UndoOutlined,
  FontSizeOutlined,
  LayoutOutlined,
  PlusOutlined,
  DeleteOutlined,
  LockOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useCmsStore } from '../../core/stores/cms.store';
import { UiSection, UiTextItem, UiBlockItem } from '../../core/types/cms.types';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export const CmsSettingsScreen: React.FC = () => {
  const { texts, blocks, updateText, resetText, toggleBlock, deleteBlock, addBlock } = useCmsStore();

  const [activeTab, setActiveTab] = useState('texts');
  const [sectionFilter, setSectionFilter] = useState<UiSection | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  // Edit Text Modal State
  const [editingText, setEditingText] = useState<UiTextItem | null>(null);
  const [textForm] = Form.useForm();

  // Add Custom Block Modal State
  const [isAddBlockOpen, setIsAddBlockOpen] = useState(false);
  const [blockForm] = Form.useForm();

  // Filtered Texts
  const textList = Object.values(texts).filter((item) => {
    const matchesSection = sectionFilter === 'ALL' || item.section === sectionFilter;
    const matchesSearch =
      !search ||
      item.description.includes(search) ||
      item.value.includes(search) ||
      item.key.includes(search);
    return matchesSection && matchesSearch;
  });

  // Block List
  const blockList = Object.values(blocks);

  const handleEditTextClick = (item: UiTextItem) => {
    setEditingText(item);
    textForm.setFieldsValue({ value: item.value });
  };

  const handleSaveText = () => {
    textForm.validateFields().then((values) => {
      if (editingText) {
        updateText(editingText.key, values.value);
        message.success(`تم تحديث النص "${editingText.description}" فورياً.`);
        setEditingText(null);
      }
    });
  };

  const handleResetText = (key: string) => {
    resetText(key);
    message.success('تمت استعادة النص الافتراضي بنجاح.');
  };

  const handleAddBlockSubmit = () => {
    blockForm.validateFields().then((values) => {
      const code = `widget_${Date.now()}`;
      const newBlock: UiBlockItem = {
        id: `b_${Date.now()}`,
        code,
        titleAr: values.titleAr,
        isEnabled: true,
        isSystem: false,
        sortOrder: blockList.length + 1,
        updatedAt: new Date().toISOString(),
      };
      addBlock(newBlock);
      message.success(`تمت إضافة كتلة الواجهة "${values.titleAr}" بنجاح.`);
      setIsAddBlockOpen(false);
      blockForm.resetFields();
    });
  };

  const textColumns = [
    {
      title: 'موضع النص ووصفه',
      dataIndex: 'description',
      key: 'description',
      render: (desc: string, record: UiTextItem) => (
        <div>
          <div className="font-bold text-cream-100 font-cairo text-sm">{desc}</div>
          <div className="text-[11px] text-mocha-400 font-mono">key: {record.key}</div>
        </div>
      ),
    },
    {
      title: 'القسم',
      dataIndex: 'section',
      key: 'section',
      width: 140,
      render: (section: UiSection) => {
        const labels: Record<UiSection, { label: string; color: string }> = {
          HEADER: { label: 'الترويسة والشعار', color: 'gold' },
          ABOUT_SHEIKH: { label: 'صاحب المجلس', color: 'cyan' },
          DASHBOARD: { label: 'لوحة التحكم', color: 'purple' },
          LOGIN: { label: 'شاشة الدخول', color: 'blue' },
          FOOTER: { label: 'التذييل', color: 'default' },
          GENERAL: { label: 'عام', color: 'default' },
        };
        const l = labels[section] || { label: section, color: 'default' };
        return (
          <Tag color={l.color} className="font-cairo font-semibold">
            {l.label}
          </Tag>
        );
      },
    },
    {
      title: 'النص الحالي المعروض',
      dataIndex: 'value',
      key: 'value',
      render: (val: string) => (
        <span className="text-cream-200 font-amiri text-sm line-clamp-2 max-w-lg">{val}</span>
      ),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: UiTextItem) => (
        <div className="flex items-center gap-2">
          <Tooltip title="تعديل النص">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEditTextClick(record)}
              className="text-gold-400 hover:text-gold-300 font-cairo"
            >
              تعديل
            </Button>
          </Tooltip>
          {record.value !== record.defaultValue && (
            <Popconfirm
              title="استعادة النص الافتراضي"
              description="هل تريد التراجع عن التعديل واسترجاع النص الأصلي؟"
              okText="استعادة"
              cancelText="إلغاء"
              onConfirm={() => handleResetText(record.key)}
            >
              <Tooltip title="استعادة النص الافتراضي">
                <Button
                  type="text"
                  icon={<UndoOutlined />}
                  className="text-amber-400 hover:text-amber-300 font-cairo"
                />
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  const blockColumns = [
    {
      title: 'اسم الكتلة / الويدجت',
      dataIndex: 'titleAr',
      key: 'titleAr',
      render: (title: string, record: UiBlockItem) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gold-500/15 border border-gold-500/30 flex items-center justify-center text-gold-400">
            <LayoutOutlined />
          </div>
          <div>
            <div className="font-bold text-cream-100 font-cairo text-sm flex items-center gap-2">
              <span>{title}</span>
              {record.isSystem && (
                <Tag color="gold" className="text-[10px] font-mono flex items-center gap-1">
                  <LockOutlined /> نظامي محمي
                </Tag>
              )}
            </div>
            <div className="text-[11px] text-mocha-400 font-mono">code: {record.code}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'حالة الظهور في الواجهة',
      dataIndex: 'isEnabled',
      key: 'isEnabled',
      width: 170,
      render: (enabled: boolean, record: UiBlockItem) => (
        <div className="flex items-center gap-2 font-cairo">
          <Switch
            checked={enabled}
            onChange={(checked) => {
              toggleBlock(record.code, checked);
              message.success(`تم ${checked ? 'تفعيل وإظهار' : 'إخفاء وتعطيل'} "${record.titleAr}".`);
            }}
            className={enabled ? 'bg-gold-500' : 'bg-mocha-700'}
          />
          <span className="text-xs text-cream-300">{enabled ? 'ظاهر للعامة' : 'مخفي'}</span>
        </div>
      ),
    },
    {
      title: 'إدارة الكتلة',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: UiBlockItem) => {
        if (record.isSystem) {
          return (
            <span className="text-xs text-mocha-400 font-cairo">
              محمي (إخفاء/إظهار فقط)
            </span>
          );
        }
        return (
          <Popconfirm
            title="تأكيد الحذف النهائي"
            description={`هل أنت متأكد من حذف كتلة "${record.titleAr}" نهائياً من لوحة التحكم؟`}
            okText="نعم، احذف"
            cancelText="إلغاء"
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              const success = deleteBlock(record.code);
              if (success) {
                message.success('تم حذف الكتلة بنجاح.');
              }
            }}
          >
            <Button danger type="text" icon={<DeleteOutlined />} className="text-red-400 hover:text-red-300 font-cairo">
              حذف
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-mocha-900 via-mocha-850 to-mocha-900 p-6 rounded-2xl border border-gold-500/30 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title
            level={3}
            className="!text-transparent !bg-clip-text !bg-gradient-to-r !from-gold-300 !to-gold-500 !mb-1 font-ruqaa font-bold"
          >
            نظام إدارة المحتوى والواجهات الديناميكي (CMS Engine)
          </Title>
          <Text className="text-cream-300 text-sm font-cairo">
            تعديل كافة نصوص وعناوين المنصة والتحكم في إظهار وإخفاء الكتل البنيوية لحظياً دون الحاجة لتعديل الكود
          </Text>
        </div>
        {activeTab === 'blocks' && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsAddBlockOpen(true)}
            className="bg-gradient-to-r from-gold-600 to-gold-500 text-mocha-950 font-bold font-cairo rounded-xl shadow-md border-none"
          >
            إضافة كتلة واجهة مخصصة
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Card className="border border-gold-500/25 bg-mocha-900/90 rounded-2xl shadow-xl overflow-hidden font-cairo">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'texts',
              label: (
                <span className="font-cairo font-bold text-sm flex items-center gap-2">
                  <FontSizeOutlined />
                  <span>تعديل نصوص وتسميات الواجهة ({textList.length})</span>
                </span>
              ),
              children: (
                <div className="space-y-4 pt-2">
                  {/* Text Filters */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 flex-1">
                      <Input
                        placeholder="ابحث بالنص أو الموضع..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        prefix={<SearchOutlined className="text-gold-400/80 ml-2" />}
                        className="max-w-xs rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100 placeholder:text-mocha-400"
                      />
                      <Select
                        value={sectionFilter}
                        onChange={(val) => setSectionFilter(val)}
                        className="w-48 font-cairo"
                      >
                        <Option value="ALL">كافة أقسام الواجهة</Option>
                        <Option value="HEADER">الترويسة والشعار</Option>
                        <Option value="ABOUT_SHEIKH">صاحب المجلس</Option>
                        <Option value="DASHBOARD">لوحة التحكم</Option>
                        <Option value="LOGIN">شاشة الدخول</Option>
                      </Select>
                    </div>
                  </div>

                  <Table
                    columns={textColumns}
                    dataSource={textList}
                    rowKey="id"
                    pagination={false}
                    className="overflow-x-auto"
                  />
                </div>
              ),
            },
            {
              key: 'blocks',
              label: (
                <span className="font-cairo font-bold text-sm flex items-center gap-2">
                  <LayoutOutlined />
                  <span>إدارة الكتل البنيوية والويدجتس ({blockList.length})</span>
                </span>
              ),
              children: (
                <div className="space-y-4 pt-2">
                  <div className="p-3.5 bg-mocha-950/60 border border-gold-500/20 rounded-xl text-xs text-cream-300 font-cairo">
                    💡 <strong>تنويه أمني:</strong> الكتل النظامية الموسومة بـ <strong className="text-gold-400">(نظامي محمي)</strong> هي عناصر هيكلية أساسية يمكن إخفاؤها أو إظهارها لضبط شكل الواجهة، ولكنها محمية من الحذف التدميري الكامل لمنع انهيار الواجهة.
                  </div>

                  <Table
                    columns={blockColumns}
                    dataSource={blockList}
                    rowKey="id"
                    pagination={false}
                    className="overflow-x-auto"
                  />
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Edit Text Modal */}
      <Modal
        open={!!editingText}
        title={
          <span className="font-ruqaa text-gold-400 font-bold text-xl">
            تعديل نص الواجهة: {editingText?.description}
          </span>
        }
        okText="حفظ وتطبيق النص فوراً"
        cancelText="إلغاء"
        onCancel={() => setEditingText(null)}
        onOk={handleSaveText}
        okButtonProps={{ className: 'bg-gold-500 hover:bg-gold-400 text-mocha-950 font-bold font-cairo' }}
        cancelButtonProps={{ className: 'font-cairo' }}
        width={600}
      >
        {editingText && (
          <Form form={textForm} layout="vertical" className="mt-4 font-cairo">
            <div className="mb-3 p-3 rounded-xl bg-mocha-950 border border-gold-500/20 text-xs text-mocha-400">
              <div>المفتاح البرمجي: <span className="font-mono text-cream-300">{editingText.key}</span></div>
              <div className="mt-1">النص الافتراضي: <span className="text-cream-300 font-amiri font-bold">{editingText.defaultValue}</span></div>
            </div>

            <Form.Item
              name="value"
              label={<span className="text-cream-200 font-bold">النص الجديد المعروض</span>}
              rules={[{ required: true, message: 'يرجى كتابة النص' }]}
            >
              <TextArea rows={4} className="font-amiri text-base leading-relaxed rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100" />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Add Custom Block Modal */}
      <Modal
        open={isAddBlockOpen}
        title={
          <span className="font-ruqaa text-gold-400 font-bold text-xl">
            إضافة كتلة واجهة مخصصة جديدة
          </span>
        }
        okText="إنشاء الكتلة"
        cancelText="إلغاء"
        onCancel={() => setIsAddBlockOpen(false)}
        onOk={handleAddBlockSubmit}
        okButtonProps={{ className: 'bg-gold-500 hover:bg-gold-400 text-mocha-950 font-bold font-cairo' }}
        cancelButtonProps={{ className: 'font-cairo' }}
      >
        <Form form={blockForm} layout="vertical" className="mt-4 font-cairo">
          <Form.Item
            name="titleAr"
            label={<span className="text-cream-200 font-bold">اسم الكتلة / الويدجت</span>}
            rules={[{ required: true, message: 'يرجى إدخال اسم الكتلة' }]}
          >
            <Input placeholder="مثال: قسم الفتاوى الرمضانية العاجلة" className="rounded-xl bg-mocha-950 border-gold-500/30 text-cream-100" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

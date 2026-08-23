import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Progress, Space, Tag, Typography, Upload } from 'antd';
import { CloudUploadOutlined, DeleteOutlined, FileDoneOutlined, StopOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api/client';
import { toArabicErrorMessage } from '../../core/api/errorMessage';
import {
  ALLOWED_TYPES_AR,
  MAX_SINGLE_PUT_BYTES,
  MediaUploadError,
  UploadProgress,
  VerifiedUpload,
  acceptAttributeForContentType,
  formatBytesAr,
  uploadMediaFile,
} from '../../core/api/mediaUpload';

const { Text } = Typography;

/**
 * The media field of the content form — real presigned upload (ADR-013 Stage A).
 *
 * Replaces a plain text input into which an editor pasted a URL. That input was
 * the visible half of the media stub: there was no upload, so the only way to
 * attach a file was to host it somewhere else by hand and hope the link survived.
 *
 * The value this field produces is a `mediaAssetId` — a row the server has
 * verified against the bucket — not a URL. Nothing here reports success on its
 * own authority: the "تم التحقق" state appears only after
 * `uploadMediaFile()` returns, and that function returns only after the API
 * confirmed the object's presence and byte count.
 *
 * The processing note is deliberate and must not be softened: ADR-013 Stage B
 * (transcoding, waveform, thumbnails) does not exist yet, so the file is stored
 * and verified but NOT processed, and the UI says exactly that.
 */

export interface MediaUploadFieldProps {
  /** mediaAssetId, or undefined when nothing is attached. */
  value?: string;
  onChange?: (mediaAssetId: string | undefined) => void;
  /** Content type from the form (AUDIO / PDF / IMAGE / TEXT) — filters the picker. */
  contentType?: string;
  disabled?: boolean;
}

type FieldPhase = 'IDLE' | 'BUSY' | 'DONE' | 'ERROR';

const PHASE_LABEL_AR: Record<UploadProgress['phase'], string> = {
  HASHING: 'حساب بصمة الملف (SHA-256)',
  UPLOADING: 'رفع الملف إلى التخزين',
  VERIFYING: 'تحقّق الخادم من الملف في التخزين',
};

export const MediaUploadField: React.FC<MediaUploadFieldProps> = ({
  value,
  onChange,
  contentType,
  disabled,
}) => {
  const [phase, setPhase] = useState<FieldPhase>('IDLE');
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [verified, setVerified] = useState<VerifiedUpload | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort an upload in flight if the modal closes under it, so the XHR does not
  // outlive the component and call setState on an unmounted tree.
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * When editing an item that already has an asset, the state is read from the
   * server rather than assumed. An asset can be PENDING_UPLOAD or ABORTED, and
   * showing "مرفوع" for either would be the same fabrication in a new place.
   */
  const {
    data: existingAsset,
    isError: isExistingAssetError,
    error: existingAssetError,
  } = useQuery({
    queryKey: ['media-asset', 'status', value],
    queryFn: async () => {
      const response = await apiClient.get(`/admin/media/${value}/status`);
      return response.data?.data as {
        id: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
        verifiedBytes: number | null;
        uploadStatus: string;
        transcodeStatus: string;
        uploadError: string | null;
      };
    },
    enabled: !!value && !verified,
    retry: 1,
    staleTime: 30_000,
  });

  const startUpload = useCallback(
    async (file: File) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('BUSY');
      setErrorText(null);
      setVerified(null);
      setProgress({ phase: 'HASHING', loadedBytes: 0, totalBytes: file.size, percent: 0 });

      try {
        const result = await uploadMediaFile({
          file,
          signal: controller.signal,
          onProgress: setProgress,
        });
        setVerified(result);
        setPhase('DONE');
        onChange?.(result.mediaAssetId);
      } catch (error) {
        // The form keeps no media id on failure. Leaving the previous value in
        // place would attach the content item to a file the editor believes was
        // replaced.
        onChange?.(undefined);
        setPhase('ERROR');
        setErrorText(
          error instanceof MediaUploadError
            ? error.message
            : toArabicErrorMessage(error, 'فشل رفع الملف'),
        );
      } finally {
        abortRef.current = null;
      }
    },
    [onChange],
  );

  const cancel = () => {
    abortRef.current?.abort();
    setPhase('IDLE');
    setProgress(null);
  };

  const detach = () => {
    setVerified(null);
    setProgress(null);
    setPhase('IDLE');
    setErrorText(null);
    onChange?.(undefined);
  };

  const accept = acceptAttributeForContentType(contentType ?? '');
  const busy = phase === 'BUSY';

  return (
    <div className="font-cairo">
      {!busy && (
        <Upload
          accept={accept}
          multiple={false}
          showUploadList={false}
          disabled={disabled}
          // Returning false stops antd from uploading anything itself: the bytes
          // must go to the presigned URL, never through our API (ADR-013 §3).
          beforeUpload={(file) => {
            void startUpload(file as unknown as File);
            return false;
          }}
        >
          <Button icon={<CloudUploadOutlined />} size="large" disabled={disabled}>
            {value || verified ? 'استبدال الملف' : 'اختر ملفاً ورفعه إلى التخزين'}
          </Button>
        </Upload>
      )}

      {!busy && !verified && !value && (
        <div className="mt-2">
          <Text type="secondary" className="text-xs">
            الأنواع المقبولة: {ALLOWED_TYPES_AR}. الملفات الأكبر من{' '}
            {formatBytesAr(MAX_SINGLE_PUT_BYTES)} تُرفع على أجزاء تلقائياً.
          </Text>
        </div>
      )}

      {busy && progress && (
        <div className="rounded-xl border border-mocha-700 p-3">
          <Space direction="vertical" size={4} className="w-full">
            <Text className="text-xs font-bold">{PHASE_LABEL_AR[progress.phase]}</Text>
            <Progress
              percent={progress.percent}
              status={progress.phase === 'VERIFYING' ? 'active' : 'normal'}
              strokeColor="#c9a227"
            />
            <Text type="secondary" className="text-xs" dir="rtl">
              {formatBytesAr(progress.loadedBytes)} من {formatBytesAr(progress.totalBytes)}
            </Text>
            <Button size="small" icon={<StopOutlined />} onClick={cancel} danger>
              إلغاء الرفع
            </Button>
          </Space>
        </div>
      )}

      {verified && (
        <Alert
          type="success"
          showIcon
          icon={<FileDoneOutlined />}
          className="mt-3 rounded-xl font-cairo"
          message={
            <span className="text-xs font-bold">
              تم رفع الملف والتحقّق منه في التخزين — {verified.fileName}
            </span>
          }
          description={
            <div className="text-xs leading-relaxed">
              <div>
                حجم مُتحقَّق منه على الخادم: {formatBytesAr(verified.verifiedBytes)} (
                {verified.verifiedBytes} بايت)
              </div>
              <div dir="ltr" className="font-mono text-[10px] break-all">
                SHA-256: {verified.sha256}
              </div>
              <div className="mt-1">
                <Tag color="gold">
                  حالة المعالجة: {verified.transcodeStatus}
                </Tag>
                {/* Not a placeholder: Stage B is genuinely not implemented, and a
                    "جاهز" badge here would be a claim about a pipeline that does
                    not exist. */}
                معالجة الوسائط (تحويل الصيغ والصور المصغّرة — ADR-013 المرحلة B) غير منفَّذة بعد،
                لذا يبقى الملف مخزَّناً كما هو دون معالجة.
              </div>
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={detach}
                className="mt-1 px-0"
              >
                فصل الملف عن هذه المادة
              </Button>
            </div>
          }
        />
      )}

      {!verified && value && existingAsset && (
        <Alert
          type={existingAsset.uploadStatus === 'UPLOADED' ? 'info' : 'warning'}
          showIcon
          className="mt-3 rounded-xl font-cairo"
          message={
            <span className="text-xs font-bold">
              ملف مرتبط بهذه المادة — {existingAsset.originalName}
            </span>
          }
          description={
            <div className="text-xs leading-relaxed">
              <div>
                حالة الرفع: {existingAsset.uploadStatus} — حالة المعالجة:{' '}
                {existingAsset.transcodeStatus}
              </div>
              {existingAsset.verifiedBytes !== null && (
                <div>حجم مُتحقَّق منه: {formatBytesAr(existingAsset.verifiedBytes)}</div>
              )}
              {existingAsset.uploadStatus !== 'UPLOADED' && (
                <div className="font-bold">
                  هذا الملف غير مُتحقَّق منه في التخزين
                  {existingAsset.uploadError ? ` — ${existingAsset.uploadError}` : ''}. استبدله
                  برفع ملف جديد.
                </div>
              )}
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={detach}
                className="mt-1 px-0"
              >
                فصل الملف عن هذه المادة
              </Button>
            </div>
          }
        />
      )}

      {!verified && value && isExistingAssetError && (
        <Alert
          type="error"
          showIcon
          className="mt-3 rounded-xl font-cairo"
          message={<span className="text-xs font-bold">تعذّر قراءة حالة الملف المرتبط من الخادم</span>}
          description={
            <span className="text-xs">
              {toArabicErrorMessage(existingAssetError, 'تعذّر جلب حالة الملف')} — لا تُفترض حالة
              الملف، لذلك لا يُعرض هنا أنه مرفوع أو معالَج.
            </span>
          }
        />
      )}

      {errorText && (
        <Alert
          type="error"
          showIcon
          className="mt-3 rounded-xl font-cairo"
          message={<span className="text-xs font-bold">فشل رفع الملف — لم يُربط أي ملف بهذه المادة</span>}
          description={<span className="text-xs leading-relaxed">{errorText}</span>}
        />
      )}
    </div>
  );
};

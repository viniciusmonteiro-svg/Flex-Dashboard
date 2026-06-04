'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
} from 'recharts';
import { toPng, toSvg } from 'html-to-image';
import domtoimage from 'dom-to-image-more';
import { formatMonthShort, formatCurrency, formatNumber } from '@/lib/format';
import { ToastContainer, type ToastItem } from '@/components/ui/Toast';
import type { KpiResponse, KpiTrend, ChannelBreakdown } from '@/app/api/dashboard/kpis/route';
import type { KpiSummaryResponse, KpiSummaryRow } from '@/app/api/dashboard/kpi-summary/route';
import type { KpiSummaryCohortResponse, KpiSummaryCohortRow } from '@/app/api/dashboard/kpi-summary-cohort/route';
import type { ChannelChartRow } from '@/app/api/dashboard/channel-chart/route';
import type { ArrCacRow, ArrCacResponse } from '@/app/api/dashboard/arr-cac-chart/route';
import type { OppTrendRow, OppTrendResponse } from '@/app/api/dashboard/opp-trend-chart/route';

// ─── Chart Export Utilities ───────────────────────────────────────────────────

interface ExportOptions {
  elementId: string;
  filename: string;
  title: string;
  subtitle?: string;
}

function addExportStyles(element: HTMLElement): () => void {
  const originalBg = element.style.background;
  const originalPosition = element.style.position;

  // Set white background and ensure proper rendering
  element.style.background = '#ffffff';
  element.style.position = 'relative';

  // Add watermark
  const watermark = document.createElement('div');
  watermark.id = 'chart-export-watermark';
  watermark.textContent = 'Marketing Dashboard';
  watermark.style.cssText = `
    position: absolute;
    bottom: 8px;
    right: 12px;
    font-size: 11px;
    color: #94a3b8;
    font-family: system-ui, sans-serif;
    pointer-events: none;
    z-index: 100;
  `;
  element.appendChild(watermark);

  // Return cleanup function
  return () => {
    element.style.background = originalBg;
    element.style.position = originalPosition;
    const wm = element.querySelector('#chart-export-watermark');
    if (wm) wm.remove();
  };
}

async function captureChart(
  element: HTMLElement,
  type: 'png' | 'svg',
  options: { title: string }
): Promise<string> {
  const filter = (node: HTMLElement) => {
    // Exclude export UI elements from capture
    return !node.classList.contains('chart-export-btn') &&
           !node.classList.contains('export-modal') &&
           !node.classList.contains('modal-overlay');
  };

  const cleanup = addExportStyles(element);

  try {
    if (type === 'png') {
      return await toPng(element, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        filter,
        style: {
          transform: 'none',
        },
      });
    } else {
      return await toSvg(element, {
        backgroundColor: '#ffffff',
        filter,
        style: {
          transform: 'none',
        },
      });
    }
  } finally {
    cleanup();
  }
}

async function downloadChart(element: HTMLElement, type: 'png' | 'svg', options: ExportOptions, addToast: (msg: string, t: ToastItem['type']) => void) {
  const cleanup = addExportStyles(element);
  try {
    const dataUrl = type === 'png'
      ? await toPng(element, { pixelRatio: 2, backgroundColor: '#ffffff' })
      : await toSvg(element, { backgroundColor: '#ffffff' });

    const link = document.createElement('a');
    link.download = options.filename;
    link.href = dataUrl;
    link.click();
    addToast(`${options.title} exported as ${type.toUpperCase()}`, 'success');
  } catch (err) {
    console.error('[ChartExport] Download error:', err);
    addToast('Failed to export chart', 'error');
  } finally {
    cleanup();
  }
}

async function copyToClipboard(element: HTMLElement, options: ExportOptions, addToast: (msg: string, t: ToastItem['type']) => void) {
  const cleanup = addExportStyles(element);
  try {
    const blob = await toPng(element, { pixelRatio: 2, backgroundColor: '#ffffff' })
      .then(async (dataUrl) => {
        const response = await fetch(dataUrl);
        return response.blob();
      });

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    addToast('Chart copied to clipboard', 'success');
  } catch (err) {
    console.error('[ChartExport] Clipboard error:', err);
    addToast('Failed to copy chart to clipboard', 'error');
  } finally {
    cleanup();
  }
}

// ─── Chart Export Modal Component ────────────────────────────────────────────

type SizePreset = 'small' | 'medium' | 'large' | 'full';
type ExportFormat = 'png' | 'svg';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  elementId: string;
  title: string;
  onAddToast: (msg: string, t: ToastItem['type']) => void;
}

const SIZE_PRESETS: { value: SizePreset; label: string; width: number }[] = [
  { value: 'small', label: 'Small — 800px', width: 800 },
  { value: 'medium', label: 'Medium — 1200px', width: 1200 },
  { value: 'large', label: 'Large — 1600px', width: 1600 },
  { value: 'full', label: 'Full Size', width: 0 },
];

function ExportModal({ isOpen, onClose, elementId, title, onAddToast }: ExportModalProps) {
  const [sizePreset, setSizePreset] = useState<SizePreset>('medium');
  const [customWidth, setCustomWidth] = useState<string>('');
  const [format, setFormat] = useState<ExportFormat>('png');
  const [isExporting, setIsExporting] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSizePreset('medium');
      setCustomWidth('');
      setFormat('png');
      setIsExporting(false);
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getTargetWidth = (): number => {
    if (sizePreset === 'full') return 0;
    if (customWidth && !isNaN(Number(customWidth)) && Number(customWidth) > 0) {
      return Number(customWidth);
    }
    const preset = SIZE_PRESETS.find((p) => p.value === sizePreset);
    return preset?.width ?? 1200;
  };

  const handleExport = async () => {
    const element = document.getElementById(elementId);
    if (!element) {
      onAddToast('Export element not found', 'error');
      onClose();
      return;
    }

    setIsExporting(true);
    const targetWidth = getTargetWidth();
    const today = new Date().toISOString().split('T')[0];
    const baseFilename = `${title.toLowerCase().replace(/\s+/g, '-')}-${today}`;

    const cleanup = addExportStyles(element);

    try {
      // Get actual chart dimensions and set explicit values for html-to-image
      const actualWidth = element.offsetWidth;
      const actualHeight = element.offsetHeight;
      const scaleFactor = targetWidth > 0 ? targetWidth / actualWidth : 2;

      const filter = (node: HTMLElement) => {
        // Skip external resources that cause CORS issues
        const tagName = node.tagName?.toUpperCase();
        if (tagName === 'LINK' && node.getAttribute('rel') === 'stylesheet') return false;
        if (tagName === 'SCRIPT') return false;
        // Skip export UI elements
        if (node.classList?.contains('chart-export-btn')) return false;
        if (node.classList?.contains('export-modal')) return false;
        if (node.classList?.contains('modal-overlay')) return false;
        return true;
      };

      if (format === 'png') {
        let dataUrl: string;
        try {
          dataUrl = await toPng(element, {
            width: actualWidth,
            height: actualHeight,
            pixelRatio: scaleFactor,
            backgroundColor: '#ffffff',
            cacheBust: true,
            skipFonts: true,
            filter,
            style: {
              transform: 'none',
              maxWidth: 'none',
              maxHeight: 'none',
            },
          });
        } catch (primaryErr) {
          // Fallback to dom-to-image-more if html-to-image fails
          console.warn('[ChartExport] html-to-image failed, trying dom-to-image-more:', primaryErr);
          const blob = await domtoimage.toBlob(element, {
            width: actualWidth,
            height: actualHeight,
            pixelRatio: scaleFactor,
            bgcolor: '#ffffff',
            style: {
              transform: 'none',
              maxWidth: 'none',
              maxHeight: 'none',
            },
          });
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        const link = document.createElement('a');
        link.download = `${baseFilename}.png`;
        link.href = dataUrl;
        link.click();
        onAddToast(`${title} exported as PNG`, 'success');
      } else {
        const dataUrl = await toSvg(element, {
          width: actualWidth,
          height: actualHeight,
          backgroundColor: '#ffffff',
          cacheBust: true,
          skipFonts: true,
          filter,
          style: {
            transform: 'none',
            maxWidth: 'none',
            maxHeight: 'none',
          },
        });
        const link = document.createElement('a');
        link.download = `${baseFilename}.svg`;
        link.href = dataUrl;
        link.click();
        onAddToast(`${title} exported as SVG`, 'success');
      }
      onClose();
    } catch (err) {
      console.error('[ChartExport] Export error:', err);
      console.error('Error details:', {
        message: (err as Error)?.message,
        stack: (err as Error)?.stack,
        name: (err as Error)?.name,
      });
      onAddToast(`Export failed: ${(err as Error)?.message || 'Unknown error'}`, 'error');
    } finally {
      cleanup();
      setIsExporting(false);
    }
  };

  const handleCopyToClipboard = async () => {
    const element = document.getElementById(elementId);
    if (!element) {
      onAddToast('Export element not found', 'error');
      onClose();
      return;
    }

    setIsExporting(true);
    const targetWidth = getTargetWidth();
    const cleanup = addExportStyles(element);

    try {
      const actualWidth = element.offsetWidth;
      const actualHeight = element.offsetHeight;
      const scaleFactor = targetWidth > 0 ? targetWidth / actualWidth : 2;

      let blob: Blob;
      try {
        const dataUrl = await toPng(element, {
          width: actualWidth,
          height: actualHeight,
          pixelRatio: scaleFactor,
          backgroundColor: '#ffffff',
          cacheBust: true,
          skipFonts: true,
          style: {
            transform: 'none',
            maxWidth: 'none',
            maxHeight: 'none',
          },
        });
        const response = await fetch(dataUrl);
        blob = await response.blob();
      } catch (primaryErr) {
        // Fallback to dom-to-image-more if html-to-image fails
        console.warn('[ChartExport] html-to-image clipboard failed, trying dom-to-image-more:', primaryErr);
        blob = await domtoimage.toBlob(element, {
          width: actualWidth,
          height: actualHeight,
          pixelRatio: scaleFactor,
          bgcolor: '#ffffff',
          style: {
            transform: 'none',
            maxWidth: 'none',
            maxHeight: 'none',
          },
        });
      }

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      onAddToast('Chart copied to clipboard', 'success');
      onClose();
    } catch (err) {
      console.error('[ChartExport] Clipboard error:', err);
      console.error('Error details:', {
        message: (err as Error)?.message,
        stack: (err as Error)?.stack,
        name: (err as Error)?.name,
      });
      onAddToast(`Copy failed: ${(err as Error)?.message || 'Unknown error'}`, 'error');
    } finally {
      cleanup();
      setIsExporting(false);
    }
  };

  return (
    <div
      className="modal-overlay export-modal"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        className="export-modal"
        style={{
          background: '#ffffff',
          borderRadius: 12,
          padding: 24,
          width: 400,
          maxWidth: '90vw',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-primary)', margin: 0, marginBottom: 4 }}>
            Export Chart
          </h3>
          <p style={{ fontSize: 13, color: 'var(--color-neutral)', margin: 0 }}>
            {title}
          </p>
        </div>

        {/* Size Presets */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-neutral)', marginBottom: 8 }}>
            Size Preset
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SIZE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setSizePreset(preset.value)}
                style={{
                  padding: '8px 12px',
                  border: `1px solid ${sizePreset === preset.value ? 'var(--color-primary)' : '#e2e8f0'}`,
                  borderRadius: 6,
                  background: sizePreset === preset.value ? 'var(--color-primary)' : '#ffffff',
                  color: sizePreset === preset.value ? '#ffffff' : 'var(--color-primary)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Width */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-neutral)', marginBottom: 8 }}>
            Custom Width (optional)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--color-primary)' }}>Width:</span>
            <input
              type="number"
              value={customWidth}
              onChange={(e) => setCustomWidth(e.target.value)}
              placeholder={getTargetWidth() > 0 ? String(getTargetWidth()) : 'auto'}
              min={100}
              max={4000}
              style={{
                width: 100,
                padding: '8px 12px',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                fontSize: 13,
                color: 'var(--color-primary)',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--color-primary)' }}>px</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral)' }}>
              (auto height)
            </span>
          </div>
        </div>

        {/* Format Selector */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-neutral)', marginBottom: 8 }}>
            Format
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setFormat('png')}
              style={{
                flex: 1,
                padding: '10px 16px',
                border: `1px solid ${format === 'png' ? 'var(--color-primary)' : '#e2e8f0'}`,
                borderRadius: 6,
                background: format === 'png' ? 'var(--color-primary)' : '#ffffff',
                color: format === 'png' ? '#ffffff' : 'var(--color-primary)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              PNG
            </button>
            <button
              onClick={() => setFormat('svg')}
              style={{
                flex: 1,
                padding: '10px 16px',
                border: `1px solid ${format === 'svg' ? 'var(--color-primary)' : '#e2e8f0'}`,
                borderRadius: 6,
                background: format === 'svg' ? 'var(--color-primary)' : '#ffffff',
                color: format === 'svg' ? '#ffffff' : 'var(--color-primary)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              SVG
            </button>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={isExporting}
            style={{
              padding: '10px 20px',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              background: '#ffffff',
              color: 'var(--color-primary)',
              fontSize: 13,
              fontWeight: 500,
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: 6,
              background: 'var(--color-primary)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 500,
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {isExporting ? (
              <>
                <span>⟳</span> Exporting...
              </>
            ) : (
              <>
                <span>⬇</span> Download
              </>
            )}
          </button>
        </div>

        {/* Copy to Clipboard (secondary action) */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
          <button
            onClick={handleCopyToClipboard}
            disabled={isExporting}
            style={{
              width: '100%',
              padding: '8px 16px',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              background: '#ffffff',
              color: 'var(--color-neutral)',
              fontSize: 12,
              fontWeight: 500,
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            📋 Copy to Clipboard
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chart Export Button Component ───────────────────────────────────────────

interface ChartExportButtonProps {
  elementId: string;
  title: string;
  onAddToast: (msg: string, t: ToastItem['type']) => void;
}

function ChartExportButton({ elementId, title, onAddToast }: ChartExportButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExportClick = async () => {
    // Close dropdown immediately
    setShowMenu(false);

    // Wait for dropdown animation to complete before showing modal
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Show the export modal
    setShowModal(true);
  };

  return (
    <>
      <div style={{ position: 'relative' }}>
        <button
          ref={buttonRef}
          className="chart-export-btn"
          onClick={() => setShowMenu(!showMenu)}
          title="Export chart"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            background: '#ffffff',
            cursor: 'pointer',
            color: '#64748b',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#3b82f6';
            e.currentTarget.style.color = '#3b82f6';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#e2e8f0';
            e.currentTarget.style.color = '#64748b';
          }}
        >
          <span style={{ fontSize: 16 }}>⬇</span>
        </button>

        {showMenu && (
          <div
            ref={menuRef}
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              overflow: 'hidden',
              zIndex: 50,
              minWidth: 160,
            }}
          >
            <button
              className="chart-export-btn"
              onClick={handleExportClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 14px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                color: '#1e293b',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span>📷</span> Export Chart...
            </button>
          </div>
        )}
      </div>

      <ExportModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        elementId={elementId}
        title={title}
        onAddToast={onAddToast}
      />
    </>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type View   = 'monthly' | 'quarterly' | 'yearly';
type Preset = '6m' | '12m' | '24m' | 'qoq' | 'all';

// ─── Accent colors (the only five hardcoded colors) ───────────────────────────

const ACCENT = {
  opportunities:   '#3b82f6',
  demoed:          '#a855f7',
  new_business:    '#22c55e',
  upsell:          '#f97316',
  show_rate:       '#14b8a6',
  demo_conversion: '#14b8a6',
  cohort_win_rate: '#22c55e',
} as const;

// ─── Channel colors & order (mirrors Pipeline Cohort / channel-chart) ─────────

const CHANNEL_COLORS: Record<string, string> = {
  'Paid Search':       '#06b6d4',
  'Paid Social':       '#f97316',
  'SEO / Organic':     '#22c55e',
  'Web Direct':        '#3b82f6',
  'Review Sites':      '#a855f7',
  'Trade Show':        '#ef4444',
  'Referral':          '#eab308',
  'Sales Development': '#38bdf8',
  'Rep Nurture':       '#0d9488',
  'Email':             '#f59e0b',
  'Other':             '#6b7280',
  'Unclassified':      '#94a3b8',
};

const CHANNEL_ORDER = [
  'Paid Search', 'Paid Social', 'SEO / Organic', 'Web Direct', 'Review Sites',
  'Trade Show', 'Referral', 'Sales Development', 'Rep Nurture', 'Email', 'Other',
  'Unclassified',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Snap a YYYY-MM string to the start of its period (quarter or year). */
function snapFrom(mk: string, v: View): string {
  if (v === 'yearly')    return `${mk.slice(0, 4)}-01`;
  if (v === 'quarterly') {
    const m = Number(mk.slice(5, 7));
    return `${mk.slice(0, 4)}-${String((Math.ceil(m / 3) - 1) * 3 + 1).padStart(2, '0')}`;
  }
  return mk;
}

/** Snap a YYYY-MM string to the end of its period (quarter or year). */
function snapTo(mk: string, v: View): string {
  if (v === 'yearly')    return `${mk.slice(0, 4)}-12`;
  if (v === 'quarterly') {
    const m = Number(mk.slice(5, 7));
    return `${mk.slice(0, 4)}-${String(Math.ceil(m / 3) * 3).padStart(2, '0')}`;
  }
  return mk;
}

/** "2025-10" → "2025-Q4" */
function monthToQuarterKey(mk: string): string {
  return `${mk.slice(0, 4)}-Q${Math.ceil(Number(mk.slice(5, 7)) / 3)}`;
}

/** "2025-Q4" → first month "2025-10" */
function quarterKeyToFrom(qk: string): string {
  const q = Number(qk.slice(-1));
  return `${qk.slice(0, 4)}-${String((q - 1) * 3 + 1).padStart(2, '0')}`;
}

/** "2025-Q4" → last month "2025-12" */
function quarterKeyToTo(qk: string): string {
  const q = Number(qk.slice(-1));
  return `${qk.slice(0, 4)}-${String(q * 3).padStart(2, '0')}`;
}

/** "2025-Q4" → "Q4 '25" */
function quarterKeyToLabel(qk: string): string {
  return `Q${qk.slice(-1)} '${qk.slice(2, 4)}`;
}

/** Derive unique sorted-desc quarter keys from a months list. */
function monthsToQuarterKeys(months: string[]): string[] {
  return [...new Set(months.map(monthToQuarterKey))].sort().reverse();
}

/** Derive unique sorted-desc year strings from a months list. */
function monthsToYears(months: string[]): string[] {
  return [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse();
}

// ─── Sparkline bar chart ──────────────────────────────────────────────────────

interface SparklineProps {
  data:   KpiTrend[];
  color:  string;
  isRate: boolean;
}

function Sparkline({ data, color, isRate }: SparklineProps) {
  if (data.length === 0) return <div style={{ height: 90 }} />;

  const angled      = data.length > 6;
  const xAxisHeight = angled ? 40 : 20;
  const chartHeight = 60 + xAxisHeight; // bars + labels

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart
        data={data}
        margin={{ top: 4, right: 0, bottom: angled ? 8 : 0, left: 0 }}
        barCategoryGap="18%"
      >
        <XAxis
          dataKey="period"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={{ stroke: '#e2e8f0' }}
          tickLine={false}
          angle={angled ? -45 : 0}
          textAnchor={angled ? 'end' : 'middle'}
          height={xAxisHeight}
          interval={0}
        />
        <Tooltip
          cursor={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as KpiTrend;
            return (
              <div
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 11,
                  color: '#f1f5f9',
                  pointerEvents: 'none',
                }}
              >
                <span style={{ color: '#94a3b8' }}>{d.period}: </span>
                {isRate ? `${d.value.toFixed(1)}%` : d.value.toLocaleString()}
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={color}
              fillOpacity={i === data.length - 1 ? 1 : 0.4}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Stacked-bar sparkline (channel breakdown) ────────────────────────────────

type StackedField = 'opportunities' | 'demoed' | 'new_business' | 'upsell';

interface StackedSparklineProps {
  data:  KpiTrend[];
  field: StackedField;
}

function StackedSparkline({ data, field }: StackedSparklineProps) {
  if (data.length === 0) return <div style={{ height: 90 }} />;

  // Channels present (with data > 0 for this field) in any period
  const channelSet = new Set<string>();
  for (const d of data) {
    for (const c of (d.by_channel ?? []) as ChannelBreakdown[]) {
      if ((c[field] ?? 0) > 0) channelSet.add(c.channel);
    }
  }
  // Known channels first (in defined order), then any unmapped ones alphabetically
  const channels = [
    ...CHANNEL_ORDER.filter((ch) => channelSet.has(ch)),
    ...[...channelSet].filter((ch) => !CHANNEL_ORDER.includes(ch)).sort(),
  ];

  // Flatten for Recharts: { period, total, [channel]: count, ... }
  interface ChartRow { period: string; total: number; [ch: string]: string | number }
  const chartData: ChartRow[] = data.map((d) => {
    const row: ChartRow = { period: d.period, total: d.value };
    for (const c of (d.by_channel ?? []) as ChannelBreakdown[]) {
      row[c.channel] = c[field] ?? 0;
    }
    return row;
  });

  const angled      = data.length > 6;
  const xAxisHeight = angled ? 40 : 20;
  const chartHeight = 60 + xAxisHeight;

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart
        data={chartData}
        margin={{ top: 4, right: 0, bottom: angled ? 8 : 0, left: 0 }}
        barCategoryGap="18%"
      >
        <XAxis
          dataKey="period"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={{ stroke: '#e2e8f0' }}
          tickLine={false}
          angle={angled ? -45 : 0}
          textAnchor={angled ? 'end' : 'middle'}
          height={xAxisHeight}
          interval={0}
        />
        <Tooltip
          cursor={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as ChartRow;
            const activeChannels = channels.filter((ch) => Number(d[ch] ?? 0) > 0);
            return (
              <div
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  padding: '6px 8px',
                  fontSize: 11,
                  color: '#f1f5f9',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ color: '#94a3b8', marginBottom: 3 }}>{d.period}</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Total: {d.total.toLocaleString()}
                </div>
                {activeChannels.map((ch) => (
                  <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span
                      style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: CHANNEL_COLORS[ch] ?? '#94a3b8',
                        flexShrink: 0,
                      }}
                    />
                    {ch}: {Number(d[ch] ?? 0).toLocaleString()}
                  </div>
                ))}
              </div>
            );
          }}
        />
        {channels.map((ch, i) => (
          <Bar
            key={ch}
            dataKey={ch}
            stackId="a"
            fill={CHANNEL_COLORS[ch] ?? '#94a3b8'}
            radius={i === channels.length - 1 ? [2, 2, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Channel legend (shown below stacked cards) ────────────────────────────────

function ChannelLegend({ channels }: { channels: string[] }) {
  if (channels.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 8px', marginTop: 8 }}>
      {channels.map((ch) => (
        <span
          key={ch}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 9, color: 'var(--color-neutral)',
          }}
        >
          <span
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: CHANNEL_COLORS[ch] ?? '#94a3b8',
              flexShrink: 0,
            }}
          />
          {ch}
        </span>
      ))}
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label:   string;
  tooltip: string;
  value:   number;
  color:   string;
  trend:   KpiTrend[];
  isRate?: boolean;
  field?:  StackedField;   // when set, renders stacked channel bars
  loading: boolean;
}

function KpiCard({ label, tooltip, value, color, trend, isRate = false, field, loading }: KpiCardProps) {
  const display = isRate ? `${value.toFixed(1)}%` : value.toLocaleString();

  // Channels with any data for this field (used for legend)
  const legendChannels = field ? (() => {
    const s = new Set<string>();
    for (const d of trend) {
      for (const c of (d.by_channel ?? []) as ChannelBreakdown[]) {
        if ((c[field] ?? 0) > 0) s.add(c.channel);
      }
    }
    return [
      ...CHANNEL_ORDER.filter((ch) => s.has(ch)),
      ...[...s].filter((ch) => !CHANNEL_ORDER.includes(ch)).sort(),
    ];
  })() : [];

  return (
    <div
      className="rounded-xl shadow-sm"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        padding: '16px 20px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {/* Label + info icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--color-neutral)',
          }}
        >
          {label}
        </span>
        <span
          title={tooltip}
          style={{ fontSize: 12, color: '#cbd5e1', cursor: 'help', lineHeight: 1, userSelect: 'none' }}
          aria-label={tooltip}
        >
          ⓘ
        </span>
      </div>

      {/* Big number */}
      {loading ? (
        <div className="animate-pulse" style={{ height: 40, width: 72, borderRadius: 6, background: '#e2e8f0', marginBottom: 14 }} />
      ) : (
        <div
          style={{
            fontSize: '2.25rem',
            fontWeight: 700,
            lineHeight: 1,
            color,
            marginBottom: 14,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {display}
        </div>
      )}

      {/* Sparkline */}
      {loading ? (
        <div className="animate-pulse" style={{ height: 90, borderRadius: 6, background: '#e2e8f0' }} />
      ) : field ? (
        <StackedSparkline data={trend} field={field} />
      ) : (
        <Sparkline data={trend} color={color} isRate={isRate} />
      )}
    </div>
  );
}

// ─── Toggle group ─────────────────────────────────────────────────────────────

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  isDisabled,
}: {
  options:    { label: string; value: T }[];
  value:      T;
  onChange:   (v: T) => void;
  isDisabled?: (v: T) => boolean;
}) {
  return (
    <div
      className="flex overflow-hidden"
      style={{ border: '1px solid #e2e8f0', borderRadius: 9999 }}
    >
      {options.map((o) => {
        const disabled = isDisabled?.(o.value) ?? false;
        const active   = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => !disabled && onChange(o.value)}
            disabled={disabled}
            className="transition-colors"
            style={{
              padding: '6px 16px',
              fontSize: 12,
              fontWeight: 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: active ? 'var(--color-primary)' : 'transparent',
              color: disabled ? '#cbd5e1' : active ? '#ffffff' : 'var(--color-neutral)',
              border: 'none',
              outline: 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Styled select ────────────────────────────────────────────────────────────

function Select({
  value,
  onChange,
  children,
}: {
  value:    string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md focus:outline-none"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        padding: '6px 10px',
        fontSize: 12,
        color: 'var(--color-primary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </select>
  );
}

// ─── KPI Summary Table ────────────────────────────────────────────────────────

// Only rows we cannot yet calculate stay as placeholders
const PLACEHOLDER_ROWS: string[] = [];

function fmtCell(v: number | null, isCurrency: boolean): string {
  if (v === null || v === 0) return '—';
  if (isCurrency) return formatCurrency(v * 100); // API returns dollars; formatCurrency takes cents
  return formatNumber(Math.round(v));
}

function fmtRatio(v: number | null): string {
  if (v === null || v === 0) return '—';
  return `${v.toFixed(1)}x`;
}

function fmtMonths(v: number | null): string {
  if (v === null || v === 0) return '—';
  return `${v.toFixed(1)} mo`;
}

/** Divide two nullable value arrays element-wise; null when denominator is 0/null. */
function divideVals(
  nums: (number | null)[],
  dens: (number | null)[],
): (number | null)[] {
  return nums.map((n, i) => {
    const d = dens[i];
    if (n === null || d === null || d === 0) return null;
    return n / d;
  });
}

/**
 * Compute the aggregate ratio as sum(numerators) / sum(denominators).
 * This matches Channel Economics "Total" column logic (ratio of totals,
 * not average of per-period ratios which gives a different — wrong — number).
 */
function ratioOfTotals(
  nums: (number | null)[],
  dens: (number | null)[],
): number | null {
  let totalNum = 0;
  let totalDen = 0;
  for (let i = 0; i < nums.length; i++) {
    const n = nums[i];
    const d = dens[i];
    if (n !== null && d !== null && d > 0) { totalNum += n; totalDen += d; }
  }
  return totalDen > 0 ? totalNum / totalDen : null;
}

interface KpiSummaryTableProps {
  data:    KpiSummaryResponse | null;
  loading: boolean;
}

function KpiSummaryTable({ data, loading }: KpiSummaryTableProps) {
  const [gmInput, setGmInput] = useState('69');  // GM% for Portfolio Payback

  const periods  = data?.periods          ?? [];
  const avgLabel = data?.period_avg_label ?? 'Avg';
  const rows     = data?.rows             ?? [];

  // Derive computed rows from the API rows
  // Hidden rows (prefixed __) are used for calculations only, not displayed
  const HIDDEN_ROWS = new Set(['__won_channeled__', 'All-in S&M Spend ($)']);
  const visibleRows = rows.filter((r) => !HIDDEN_ROWS.has(r.metric));
  const allInRow    = rows.find((r) => r.metric === 'All-in S&M Spend ($)');

  const spendRow         = rows.find((r) => r.metric === 'Total S&M Spend ($)');
  const oppsRow          = rows.find((r) => r.metric === 'Total Opportunities (count)');
  const wonChanneledRow  = rows.find((r) => r.metric === '__won_channeled__');
  const arrRow           = rows.find((r) => r.metric === 'Total Closed Won ARR ($)');

  // Portfolio $ / Opp = Spend / Opps
  const dollarPerOppVals = spendRow && oppsRow
    ? divideVals(spendRow.values, oppsRow.values) : null;

  // Portfolio CAC = Spend / Channeled Closed Won Deals
  const cacVals = spendRow && wonChanneledRow
    ? divideVals(spendRow.values, wonChanneledRow.values) : null;

  // Portfolio ARR : CAC = ARR / Spend
  const arrToCacVals = arrRow && spendRow
    ? divideVals(arrRow.values, spendRow.values) : null;

  // Portfolio Payback (Months) = CAC / (ASP / 12 × GM%) = Spend × 12 / (ARR × GM%)
  const gm = Math.min(100, Math.max(1, Number(gmInput) || 69)) / 100;
  const paybackVals = spendRow && arrRow
    ? divideVals(
        spendRow.values.map((v) => (v === null ? null : v * 12)),
        arrRow.values.map((v)  => (v === null ? null : v * gm)),
      )
    : null;

  return (
    <div
      className="rounded-xl shadow-sm"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        marginTop: 32,
      }}
    >
      {/* Section header */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-neutral)' }}>
          KPI Summary — Same Quarter View
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px 20px',
                  fontWeight: 600,
                  fontSize: 11,
                  color: 'var(--color-neutral)',
                  whiteSpace: 'nowrap',
                  minWidth: 160,
                }}
              >
                Metric
              </th>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <th key={i} style={{ padding: '8px 12px', minWidth: 80 }}>
                      <div className="animate-pulse" style={{ height: 12, borderRadius: 4, background: '#e2e8f0' }} />
                    </th>
                  ))
                : periods.map((p) => (
                    <th
                      key={p}
                      style={{
                        textAlign: 'right',
                        padding: '8px 12px',
                        fontWeight: 600,
                        fontSize: 11,
                        color: 'var(--color-neutral)',
                        whiteSpace: 'nowrap',
                        minWidth: 80,
                      }}
                    >
                      {p}
                    </th>
                  ))}
              {/* Avg column */}
              <th
                style={{
                  textAlign: 'right',
                  padding: '8px 16px 8px 12px',
                  fontWeight: 700,
                  fontSize: 11,
                  color: 'var(--color-success, #22c55e)',
                  whiteSpace: 'nowrap',
                  minWidth: 90,
                  borderLeft: '1px solid #e2e8f0',
                }}
              >
                {loading ? '—' : avgLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Data rows */}
            {loading
              ? Array.from({ length: 9 }).map((_, ri) => (
                  <tr key={ri} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 20px' }}>
                      <div className="animate-pulse" style={{ height: 12, width: 120, borderRadius: 4, background: '#e2e8f0' }} />
                    </td>
                    {Array.from({ length: 7 }).map((_, ci) => (
                      <td key={ci} style={{ padding: '10px 12px' }}>
                        <div className="animate-pulse" style={{ height: 12, borderRadius: 4, background: '#e2e8f0' }} />
                      </td>
                    ))}
                  </tr>
                ))
              : visibleRows.map((row: KpiSummaryRow, ri) => (
                  <tr
                    key={row.metric}
                    style={{ borderBottom: '1px solid #f1f5f9' }}
                  >
                    <td
                      style={{
                        padding: '10px 20px',
                        fontWeight: 500,
                        color: 'var(--color-primary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.metric}
                    </td>
                    {row.values.map((v, ci) => (
                      <td
                        key={ci}
                        style={{
                          textAlign: 'right',
                          padding: '10px 12px',
                          color: v === null ? '#cbd5e1' : 'var(--color-primary)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmtCell(v, row.is_currency)}
                      </td>
                    ))}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 16px 10px 12px',
                        fontWeight: 700,
                        color: 'var(--color-success, #22c55e)',
                        fontVariantNumeric: 'tabular-nums',
                        borderLeft: '1px solid #e2e8f0',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtCell(row.avg, row.is_currency)}
                    </td>
                  </tr>
                ))}

            {/* ── Computed rows ───────────────────────────────────────── */}
            {!loading && (() => {
              // Each computed row carries its numerator + denominator arrays so the
              // aggregate column uses ratio-of-totals (matching Channel Economics "Total"
              // footer) rather than average-of-per-period-ratios (which gives a different number).
              type ComputedRow = {
                label:     string;
                labelNode?: React.ReactNode;  // optional custom label cell content
                vals:      (number | null)[];
                agg:       number | null;     // ratio of totals across all periods
                fmt:       (v: number | null) => string;
              };

              const spendVals = spendRow?.values ?? [];
              const oppsVals  = oppsRow?.values  ?? [];
              const wonVals   = wonChanneledRow?.values ?? [];
              const arrVals   = arrRow?.values   ?? [];

              const computed: ComputedRow[] = [
                {
                  label: 'Portfolio $ / Opp',
                  vals: dollarPerOppVals ?? [],
                  agg:  ratioOfTotals(spendVals, oppsVals),
                  fmt:  (v) => fmtCell(v, true),
                },
                {
                  label: 'Portfolio CAC',
                  vals: cacVals ?? [],
                  agg:  ratioOfTotals(spendVals, wonVals),
                  fmt:  (v) => fmtCell(v, true),
                },
                {
                  label: 'Portfolio ARR : CAC',
                  vals: arrToCacVals ?? [],
                  agg:  ratioOfTotals(arrVals, spendVals),
                  fmt:  fmtRatio,
                },
                {
                  label: 'Portfolio Payback (Months)',
                  labelNode: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      Portfolio Payback (Months)
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontWeight: 400, color: 'var(--color-neutral)' }}>
                        <span style={{ fontSize: 11 }}>GM%</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 1, border: '1px solid #e2e8f0', borderRadius: 4, padding: '1px 4px', background: '#f8fafc' }}>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={gmInput}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setGmInput(e.target.value)}
                            onBlur={(e) => {
                              const v = Math.min(100, Math.max(1, Number(e.target.value) || 69));
                              setGmInput(String(v));
                            }}
                            style={{ width: 32, background: 'transparent', border: 'none', outline: 'none', textAlign: 'right', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                          />
                          <span style={{ fontSize: 11 }}>%</span>
                        </span>
                      </span>
                    </span>
                  ),
                  vals: paybackVals ?? [],
                  agg:  ratioOfTotals(
                    spendVals.map((v) => (v === null ? null : v * 12)),
                    arrVals.map((v)  => (v === null ? null : v * gm)),
                  ),
                  fmt:  fmtMonths,
                },
              ];

              return computed
                .filter(({ vals }) => vals.length > 0)
                .map(({ label, labelNode, vals, agg, fmt }) => (
                  <tr key={label} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 20px', fontWeight: 500, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
                      {labelNode ?? label}
                    </td>
                    {vals.map((v, ci) => (
                      <td
                        key={ci}
                        style={{
                          textAlign: 'right',
                          padding: '10px 12px',
                          color: v === null ? '#cbd5e1' : 'var(--color-primary)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmt(v)}
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', padding: '10px 16px 10px 12px', fontWeight: 700, color: 'var(--color-success, #22c55e)', fontVariantNumeric: 'tabular-nums', borderLeft: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                      {fmt(agg)}
                    </td>
                  </tr>
                ));
            })()}

            {/* ── All-in S&M Spend — always last, italicised ──────────── */}
            {!loading && allInRow && (
              <tr key="all-in" style={{ borderTop: '2px solid #e2e8f0' }}>
                <td
                  style={{
                    padding: '10px 20px',
                    fontStyle: 'italic',
                    fontWeight: 400,
                    color: 'var(--color-neutral)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {allInRow.metric}
                </td>
                {allInRow.values.map((v, ci) => (
                  <td
                    key={ci}
                    style={{
                      textAlign: 'right',
                      padding: '10px 12px',
                      fontStyle: 'italic',
                      color: v === null ? '#cbd5e1' : 'var(--color-neutral)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fmtCell(v, allInRow.is_currency)}
                  </td>
                ))}
                <td
                  style={{
                    textAlign: 'right',
                    padding: '10px 16px 10px 12px',
                    fontStyle: 'italic',
                    fontWeight: 600,
                    color: 'var(--color-neutral)',
                    fontVariantNumeric: 'tabular-nums',
                    borderLeft: '1px solid #e2e8f0',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {fmtCell(allInRow.avg, allInRow.is_currency)}
                </td>
              </tr>
            )}

            {/* Placeholder rows */}
            {!loading && PLACEHOLDER_ROWS.map((label) => (
              <tr key={label} style={{ borderBottom: '1px solid #f1f5f9', opacity: 0.4 }}>
                <td
                  style={{
                    padding: '10px 20px',
                    fontStyle: 'italic',
                    color: 'var(--color-neutral)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </td>
                <td
                  colSpan={periods.length + 1}
                  style={{
                    textAlign: 'center',
                    padding: '10px 12px',
                    color: '#cbd5e1',
                    fontSize: 12,
                    borderLeft: 'none',
                  }}
                >
                  coming soon
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── KPI Summary Cohort Table (also used for Close Date View) ─────────────────

interface KpiSummaryCohortTableProps {
  data:    KpiSummaryCohortResponse | null;
  loading: boolean;
  title?:  string;
}

function fmtCohortCell(v: number | null, format: KpiSummaryCohortRow['format']): string {
  if (v === null || v === 0) return '—';
  if (format === 'currency') return formatCurrency(v * 100);
  if (format === 'ratio')    return `${v.toFixed(1)}x`;
  return formatNumber(Math.round(v));
}

function KpiSummaryCohortTable({ data, loading, title = 'KPI Summary — Cohort View (Lagged)' }: KpiSummaryCohortTableProps) {
  const periods  = data?.periods          ?? [];
  const avgLabel = data?.period_avg_label ?? 'Avg';
  const rows     = data?.rows             ?? [];

  return (
    <div
      className="rounded-xl shadow-sm"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        marginTop: 20,
      }}
    >
      {/* Section header */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-neutral)' }}>
          {title}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px 20px',
                  fontWeight: 600,
                  fontSize: 11,
                  color: 'var(--color-neutral)',
                  whiteSpace: 'nowrap',
                  minWidth: 160,
                }}
              >
                Metric
              </th>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <th key={i} style={{ padding: '8px 12px', minWidth: 80 }}>
                      <div className="animate-pulse" style={{ height: 12, borderRadius: 4, background: '#e2e8f0' }} />
                    </th>
                  ))
                : periods.map((p) => (
                    <th
                      key={p}
                      style={{
                        textAlign: 'right',
                        padding: '8px 12px',
                        fontWeight: 600,
                        fontSize: 11,
                        color: 'var(--color-neutral)',
                        whiteSpace: 'nowrap',
                        minWidth: 80,
                      }}
                    >
                      {p}
                    </th>
                  ))}
              {/* Avg column */}
              <th
                style={{
                  textAlign: 'right',
                  padding: '8px 16px 8px 12px',
                  fontWeight: 700,
                  fontSize: 11,
                  color: 'var(--color-success, #22c55e)',
                  whiteSpace: 'nowrap',
                  minWidth: 90,
                  borderLeft: '1px solid #e2e8f0',
                }}
              >
                {loading ? '—' : avgLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, ri) => (
                  <tr key={ri} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 20px' }}>
                      <div className="animate-pulse" style={{ height: 12, width: 140, borderRadius: 4, background: '#e2e8f0' }} />
                    </td>
                    {Array.from({ length: 7 }).map((_, ci) => (
                      <td key={ci} style={{ padding: '10px 12px' }}>
                        <div className="animate-pulse" style={{ height: 12, borderRadius: 4, background: '#e2e8f0' }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row: KpiSummaryCohortRow) => (
                  <tr key={row.metric} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td
                      style={{
                        padding: '10px 20px',
                        fontWeight: 500,
                        color: 'var(--color-primary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.metric}
                    </td>
                    {row.values.map((v, ci) => (
                      <td
                        key={ci}
                        style={{
                          textAlign: 'right',
                          padding: '10px 12px',
                          color: v === null ? '#cbd5e1' : 'var(--color-primary)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmtCohortCell(v, row.format)}
                      </td>
                    ))}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 16px 10px 12px',
                        fontWeight: 700,
                        color: 'var(--color-success, #22c55e)',
                        fontVariantNumeric: 'tabular-nums',
                        borderLeft: '1px solid #e2e8f0',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtCohortCell(row.avg, row.format)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardClient() {
  const [view,    setView]    = useState<View>('monthly');
  const [preset,  setPreset]  = useState<Preset>('6m');
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');
  const [months,    setMonths]    = useState<string[]>([]);
  const [nsLatest,  setNsLatest]  = useState<string>('');
  const [data,          setData]          = useState<KpiResponse | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [summaryData,   setSummaryData]   = useState<KpiSummaryResponse | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [cohortData,    setCohortData]    = useState<KpiSummaryCohortResponse | null>(null);
  const [loadingCohort, setLoadingCohort] = useState(true);
  const [chartData,     setChartData]     = useState<ChannelChartRow[]>([]);
  const [loadingChart,  setLoadingChart]  = useState(true);
  const [chartView,     setChartView]     = useState<View>('quarterly');
  const [chartPeriod,   setChartPeriod]   = useState('');
  const [arrCacData,    setArrCacData]    = useState<ArrCacRow[]>([]);
  const [loadingArrCac, setLoadingArrCac] = useState(true);
  const [arrCacView,      setArrCacView]      = useState<View>('quarterly');
  const [arrCacFrom,      setArrCacFrom]      = useState('');
  const [arrCacTo,        setArrCacTo]        = useState('');
  const [oppTrendData,    setOppTrendData]    = useState<OppTrendRow[]>([]);
  const [loadingOppTrend, setLoadingOppTrend] = useState(true);
  const [oppTrendView,    setOppTrendView]    = useState<View>('quarterly');
  const [oppTrendFrom,    setOppTrendFrom]    = useState('');
  const [oppTrendTo,      setOppTrendTo]      = useState('');

  const initialized = useRef(false);
  const isQoQ = preset === 'qoq';

  // ── Toast notifications ────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastItem['type']) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Load months list ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/salesforce/months')
      .then((r) => r.json())
      .then((d) => {
        setMonths(d.months ?? []);
        if (d.ns_latest) setNsLatest(d.ns_latest);
      });
  }, []);

  // ── Initialize date range once months load ─────────────────────────────────
  // months[] is DESC (newest first): months[0] = latest, months[last] = earliest
  useEffect(() => {
    if (months.length === 0 || initialized.current) return;
    initialized.current = true;
    const latest   = months[0];
    const earliest = months[months.length - 1];
    const f = addMonths(latest, -5); // last 6 months (default)
    const rawFrom  = f < earliest ? earliest : f;
    // Snap to the active view's period boundaries (default view is 'monthly',
    // so snapFrom/snapTo are no-ops here — but kept for correctness if view
    // ever initialises differently in the future).
    setFrom(snapFrom(rawFrom, view));
    setTo(snapTo(latest, view));
    setPreset('6m');
  }, [months]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Preset handler ─────────────────────────────────────────────────────────
  const applyPreset = useCallback((p: Preset) => {
    if (months.length === 0) return;
    const latest   = months[0];
    const earliest = months[months.length - 1];
    setPreset(p);

    let newFrom: string;
    let newTo:   string;
    let newView  = view;

    if (p === 'qoq') {
      newView = 'quarterly';
      setView('quarterly');
      const qFrom = addMonths(latest, -14);
      newFrom = qFrom < earliest ? earliest : qFrom;
      newTo   = latest;
    } else if (p === 'all') {
      newFrom = earliest;
      newTo   = latest;
    } else {
      const delta = p === '6m' ? -5 : p === '12m' ? -11 : -23;
      const f = addMonths(latest, delta);
      newFrom = f < earliest ? earliest : f;
      newTo   = latest;
    }

    // Snap to full period boundaries for the active view
    setFrom(snapFrom(newFrom, newView));
    setTo(snapTo(newTo, newView));
  }, [months, view]);

  // ── Fetch KPIs ─────────────────────────────────────────────────────────────
  const fetchKpis = useCallback(async (v: View, f: string, t: string) => {
    if (!f || !t) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ view: v, from: f, to: t });
      const res = await fetch(`/api/dashboard/kpis?${params}`);
      const d: KpiResponse = await res.json();
      setData(d);
    } catch (err) {
      console.error('[DashboardClient] fetchKpis error', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch KPI Summary ──────────────────────────────────────────────────────
  const fetchSummary = useCallback(async (v: View, f: string, t: string) => {
    if (!f || !t) return;
    setLoadingSummary(true);
    try {
      const params = new URLSearchParams({ view: v, from: f, to: t, period_type: 'transaction' });
      const res = await fetch(`/api/dashboard/kpi-summary?${params}`);
      const d: KpiSummaryResponse = await res.json();
      setSummaryData(d);
    } catch (err) {
      console.error('[DashboardClient] fetchSummary error', err);
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  // ── Fetch KPI Summary Cohort ──────────────────────────────────────────────
  const fetchCohortSummary = useCallback(async (v: View, f: string, t: string) => {
    if (!f || !t) return;
    setLoadingCohort(true);
    try {
      const params = new URLSearchParams({ view: v, from: f, to: t, period_type: 'transaction' });
      const res = await fetch(`/api/dashboard/kpi-summary-cohort?${params}`);
      const d: KpiSummaryCohortResponse = await res.json();
      setCohortData(d);
    } catch (err) {
      console.error('[DashboardClient] fetchCohortSummary error', err);
    } finally {
      setLoadingCohort(false);
    }
  }, []);


  // ── Fetch Channel Chart ───────────────────────────────────────────────────
  const fetchChart = useCallback(async (f: string, t: string) => {
    if (!f || !t) return;
    setLoadingChart(true);
    try {
      const params = new URLSearchParams({ from: f, to: t, period_type: 'transaction' });
      const res = await fetch(`/api/dashboard/channel-chart?${params}`);
      const d = await res.json();
      setChartData(d.rows ?? []);
    } catch (err) {
      console.error('[DashboardClient] fetchChart error', err);
    } finally {
      setLoadingChart(false);
    }
  }, []);

  // ── Fetch ARR:CAC Chart ───────────────────────────────────────────────────
  const fetchArrCac = useCallback(async (v: View, f: string, t: string) => {
    if (!f || !t) return;
    setLoadingArrCac(true);
    try {
      const params = new URLSearchParams({ view: v, from: f, to: t, period_type: 'transaction' });
      const res = await fetch(`/api/dashboard/arr-cac-chart?${params}`);
      const d: ArrCacResponse = await res.json();
      setArrCacData(d.rows ?? []);
    } catch (err) {
      console.error('[DashboardClient] fetchArrCac error', err);
    } finally {
      setLoadingArrCac(false);
    }
  }, []);

  // Initialize chart period when months load.
  // Use ns_latest so the default period has complete NS spend data.
  useEffect(() => {
    if (months.length === 0 || chartPeriod) return;
    const anchor = nsLatest || months[0];
    if (chartView === 'quarterly') {
      setChartPeriod(monthToQuarterKey(anchor));
    } else if (chartView === 'yearly') {
      setChartPeriod(anchor.slice(0, 4));
    } else {
      setChartPeriod(anchor);
    }
  }, [months, nsLatest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch chart when chartPeriod or chartView changes
  useEffect(() => {
    if (!chartPeriod) return;
    let f: string;
    let t: string;
    if (chartView === 'quarterly') {
      f = quarterKeyToFrom(chartPeriod);
      t = quarterKeyToTo(chartPeriod);
    } else if (chartView === 'yearly') {
      f = `${chartPeriod}-01`;
      t = `${chartPeriod}-12`;
    } else {
      f = chartPeriod;
      t = chartPeriod;
    }
    fetchChart(f, t);
  }, [chartPeriod, chartView, fetchChart]);

  // When chart view changes, re-derive chartPeriod from current selection
  const handleChartViewChange = (v: View) => {
    const prev = chartPeriod;
    setChartView(v);
    if (!prev) return;
    if (v === 'quarterly') {
      // Convert current period to its quarter
      const mk = prev.length === 7 ? prev : prev.includes('-Q') ? quarterKeyToFrom(prev) : `${prev}-01`;
      setChartPeriod(monthToQuarterKey(mk));
    } else if (v === 'yearly') {
      setChartPeriod(prev.slice(0, 4));
    } else {
      // Monthly — pick the first month of the current period
      if (prev.includes('-Q')) {
        setChartPeriod(quarterKeyToFrom(prev));
      } else if (prev.length === 4) {
        setChartPeriod(`${prev}-01`);
      }
      // else already a month
    }
  };

  // ── Fetch $ / Opp Trend ───────────────────────────────────────────────────
  const fetchOppTrend = useCallback(async (v: View, f: string, t: string) => {
    if (!f || !t) return;
    setLoadingOppTrend(true);
    try {
      const params = new URLSearchParams({ view: v, from: f, to: t, period_type: 'transaction' });
      const res = await fetch(`/api/dashboard/opp-trend-chart?${params}`);
      const d: OppTrendResponse = await res.json();
      setOppTrendData(d.rows ?? []);
    } catch (err) {
      console.error('[DashboardClient] fetchOppTrend error', err);
    } finally {
      setLoadingOppTrend(false);
    }
  }, []);

  useEffect(() => {
    if (from && to) {
      fetchKpis(view, from, to);
      fetchSummary(view, from, to);
      fetchCohortSummary(view, from, to);
    }
  }, [view, from, to, fetchKpis, fetchSummary, fetchCohortSummary]);

  // ── $ / Opp Trend chart — independent period filter ──────────────────────
  // Anchors "to" on actual NS latest so the 12M range ends at the last month
  // with NS spend data rather than a Salesforce-only month.
  useEffect(() => {
    if (months.length === 0 || oppTrendFrom) return;
    const anchor  = nsLatest || months[0];
    const earliest = months[months.length - 1];
    const f = addMonths(anchor, -11);
    const rawFrom = f < earliest ? earliest : f;
    setOppTrendTo(snapTo(anchor, 'quarterly'));
    setOppTrendFrom(snapFrom(rawFrom, 'quarterly'));
  }, [months, nsLatest]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOppTrendViewChange = (v: View) => {
    setOppTrendView(v);
    if (oppTrendFrom) setOppTrendFrom(snapFrom(oppTrendFrom, v));
    if (oppTrendTo)   setOppTrendTo(snapTo(oppTrendTo, v));
  };

  useEffect(() => {
    if (oppTrendFrom && oppTrendTo) fetchOppTrend(oppTrendView, oppTrendFrom, oppTrendTo);
  }, [oppTrendView, oppTrendFrom, oppTrendTo, fetchOppTrend]);

  // ── ARR:CAC chart — independent period filter ─────────────────────────────
  // Initialize once months load (default: last 4 quarters, quarterly view)
  // Anchors "to" on actual NS latest so the range ends at the last month with
  // NS spend data rather than a Salesforce-only future month.
  useEffect(() => {
    if (months.length === 0 || arrCacFrom) return;
    const anchor  = nsLatest || months[0];
    const earliest = months[months.length - 1];
    const f = addMonths(anchor, -11);
    const rawFrom = f < earliest ? earliest : f;
    setArrCacTo(snapTo(anchor, 'quarterly'));
    setArrCacFrom(snapFrom(rawFrom, 'quarterly'));
  }, [months, nsLatest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snap from/to when the ARR:CAC chart view toggle changes
  const handleArrCacViewChange = (v: View) => {
    setArrCacView(v);
    if (arrCacFrom) setArrCacFrom(snapFrom(arrCacFrom, v));
    if (arrCacTo)   setArrCacTo(snapTo(arrCacTo, v));
  };

  // Fetch whenever its own view/range changes
  useEffect(() => {
    if (arrCacFrom && arrCacTo) fetchArrCac(arrCacView, arrCacFrom, arrCacTo);
  }, [arrCacView, arrCacFrom, arrCacTo, fetchArrCac]);

  // ── View change: snap from/to to the new view's period boundaries ──────────
  const handleViewChange = (v: View) => {
    if (isQoQ) setPreset('6m');
    setView(v);
    if (from) setFrom(snapFrom(from, v));
    if (to)   setTo(snapTo(to, v));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const kpis = data?.kpis;

  return (
    <div style={{ color: 'var(--color-primary)' }}>

      {/* ── Page title ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 2 }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-neutral)' }}>
          Pipeline KPIs for opportunities created in the selected period.
        </p>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div
        className="rounded-xl"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          padding: '14px 16px',
          marginBottom: 20,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
        }}
      >
        {/* View toggle */}
        <ToggleGroup<View>
          options={[
            { label: 'Monthly',   value: 'monthly'   },
            { label: 'Quarterly', value: 'quarterly' },
            { label: 'Yearly',    value: 'yearly'    },
          ]}
          value={view}
          onChange={handleViewChange}
          isDisabled={(v) => isQoQ && v !== 'quarterly'}
        />

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Quick range */}
        <ToggleGroup<Preset>
          options={[
            { label: 'Last 6M',  value: '6m'  },
            { label: 'Last 12M', value: '12m' },
            { label: 'Last 24M', value: '24m' },
            { label: 'QoQ',      value: 'qoq' },
            { label: 'All Time', value: 'all' },
          ]}
          value={preset}
          onChange={applyPreset}
        />

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />

        {/* From / To dropdowns — content adapts to the active view */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--color-neutral)' }}>From</span>

          {view === 'quarterly' ? (() => {
            const quarters = monthsToQuarterKeys(months);
            const fromQ    = from ? monthToQuarterKey(from) : '';
            const toQ      = to   ? monthToQuarterKey(to)   : '';
            return (
              <Select
                value={fromQ}
                onChange={(q) => { setFrom(quarterKeyToFrom(q)); setPreset('all'); }}
              >
                {quarters
                  .filter((q) => !toQ || q <= toQ)
                  .map((q) => (
                    <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                  ))}
              </Select>
            );
          })() : view === 'yearly' ? (() => {
            const years = monthsToYears(months);
            const fromY = from ? from.slice(0, 4) : '';
            const toY   = to   ? to.slice(0, 4)   : '';
            return (
              <Select
                value={fromY}
                onChange={(y) => { setFrom(`${y}-01`); setPreset('all'); }}
              >
                {years
                  .filter((y) => !toY || y <= toY)
                  .map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
              </Select>
            );
          })() : (
            <Select
              value={from}
              onChange={(v) => { setFrom(v); setPreset('all'); }}
            >
              {months
                .filter((m) => !to || m <= to)
                .map((m) => (
                  <option key={m} value={m}>{formatMonthShort(m)}</option>
                ))}
            </Select>
          )}

          <span style={{ fontSize: 12, color: 'var(--color-neutral)' }}>to</span>

          {view === 'quarterly' ? (() => {
            const quarters = monthsToQuarterKeys(months);
            const fromQ    = from ? monthToQuarterKey(from) : '';
            const toQ      = to   ? monthToQuarterKey(to)   : '';
            return (
              <Select
                value={toQ}
                onChange={(q) => { setTo(quarterKeyToTo(q)); setPreset('all'); }}
              >
                {quarters
                  .filter((q) => !fromQ || q >= fromQ)
                  .map((q) => (
                    <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                  ))}
              </Select>
            );
          })() : view === 'yearly' ? (() => {
            const years = monthsToYears(months);
            const fromY = from ? from.slice(0, 4) : '';
            const toY   = to   ? to.slice(0, 4)   : '';
            return (
              <Select
                value={toY}
                onChange={(y) => { setTo(`${y}-12`); setPreset('all'); }}
              >
                {years
                  .filter((y) => !fromY || y >= fromY)
                  .map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
              </Select>
            );
          })() : (
            <Select
              value={to}
              onChange={(v) => { setTo(v); setPreset('all'); }}
            >
              {months
                .filter((m) => !from || m >= from)
                .map((m) => (
                  <option key={m} value={m}>{formatMonthShort(m)}</option>
                ))}
            </Select>
          )}
        </div>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 16,
        }}
      >
        <KpiCard
          label="Opportunities"
          tooltip="Total opportunities created in the period, stacked by channel"
          value={kpis?.opportunities.current ?? 0}
          color={ACCENT.opportunities}
          trend={kpis?.opportunities.trend ?? []}
          field="opportunities"
          loading={loading}
        />
        <KpiCard
          label="Demoed"
          tooltip="Opportunities where a demo was completed, stacked by channel"
          value={kpis?.demoed.current ?? 0}
          color={ACCENT.demoed}
          trend={kpis?.demoed.trend ?? []}
          field="demoed"
          loading={loading}
        />
        <KpiCard
          label="New"
          tooltip="New business opportunities (Order Type = New), stacked by channel"
          value={kpis?.new_business.current ?? 0}
          color={ACCENT.new_business}
          trend={kpis?.new_business.trend ?? []}
          field="new_business"
          loading={loading}
        />
        <KpiCard
          label="Upsell Group"
          tooltip="Upsell opportunities (Order Type = Upsell Group), stacked by channel"
          value={kpis?.upsell.current ?? 0}
          color={ACCENT.upsell}
          trend={kpis?.upsell.trend ?? []}
          field="upsell"
          loading={loading}
        />
        <KpiCard
          label="Show Rate"
          tooltip="Demoed ÷ Opportunities × 100"
          value={kpis?.show_rate.current ?? 0}
          color={ACCENT.show_rate}
          trend={kpis?.show_rate.trend ?? []}
          isRate
          loading={loading}
        />
        <KpiCard
          label="Demo Conversion"
          tooltip="Closed Won ÷ Demoed Opportunities"
          value={kpis?.demo_conversion.current ?? 0}
          color={ACCENT.demo_conversion}
          trend={kpis?.demo_conversion.trend ?? []}
          isRate
          loading={loading}
        />
        <KpiCard
          label="Cohort Win Rate"
          tooltip="Closed Won ÷ Total Opportunities Created"
          value={kpis?.cohort_win_rate.current ?? 0}
          color={ACCENT.cohort_win_rate}
          trend={kpis?.cohort_win_rate.trend ?? []}
          isRate
          loading={loading}
        />
      </div>

      {/* ── KPI Summary Table ─────────────────────────────────────────────── */}
      <KpiSummaryTable data={summaryData} loading={loadingSummary} />

      {/* ── KPI Summary Cohort Table ──────────────────────────────────────── */}
      <KpiSummaryCohortTable data={cohortData} loading={loadingCohort} />

      {/* ── Channel Chart: Closed Won & CAC ──────────────────────────────── */}
      <div
        id="chart-channel-cac"
        className="chart-card rounded-xl shadow-sm group"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          padding: 24,
          marginTop: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 2 }}>
              Closed Won &amp; Cohort CAC by Channel
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-neutral)' }}>
              Bar = Closed Won deals | Line = CAC ($ per won deal)
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ChartExportButton
              elementId="chart-channel-cac"
              title="Closed Won & Cohort CAC by Channel"
              onAddToast={addToast}
            />
            <ToggleGroup<View>
              options={[
                { label: 'Monthly',   value: 'monthly'   },
                { label: 'Quarterly', value: 'quarterly' },
                { label: 'Yearly',    value: 'yearly'    },
              ]}
              value={chartView}
              onChange={handleChartViewChange}
            />

            <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

            {chartView === 'quarterly' ? (
              <Select
                value={chartPeriod}
                onChange={setChartPeriod}
              >
                {monthsToQuarterKeys(months).map((q) => (
                  <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                ))}
              </Select>
            ) : chartView === 'yearly' ? (
              <Select
                value={chartPeriod}
                onChange={setChartPeriod}
              >
                {monthsToYears(months).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
            ) : (
              <Select
                value={chartPeriod}
                onChange={setChartPeriod}
              >
                {months.map((m) => (
                  <option key={m} value={m}>{formatMonthShort(m)}</option>
                ))}
              </Select>
            )}
          </div>
        </div>

        {loadingChart ? (
          <div className="animate-pulse" style={{ height: 400, borderRadius: 8, background: '#f1f5f9' }} />
        ) : chartData.length === 0 ? (
          <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
            No data for selected period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData} margin={{ top: 20, right: 60, bottom: 60, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="channel"
                tick={{ fontSize: 12 }}
                angle={-35}
                textAnchor="end"
                height={70}
              />
              <YAxis
                yAxisId="left"
                orientation="left"
                tickFormatter={(v) => v.toLocaleString()}
                label={{ value: 'Closed Won (count)', angle: -90, position: 'insideLeft', offset: -10, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v) => formatCurrency(v * 100)}
                label={{ value: 'CAC ($)', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'Closed Won') return [value.toLocaleString(), 'Closed Won'];
                  if (name === 'Cohort CAC') return [formatCurrency(value * 100), 'Cohort CAC'];
                  return [value, name];
                }}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar
                yAxisId="left"
                dataKey="won"
                name="Closed Won"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
                maxBarSize={60}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cac"
                name="Cohort CAC"
                stroke="#f97316"
                strokeWidth={2}
                dot={{ fill: '#f97316', r: 5 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Chart 2: Closed Won Deals & ARR:CAC Ratio ────────────────────── */}
      <div
        id="chart-arr-cac"
        className="chart-card rounded-xl shadow-sm group"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          padding: 24,
          marginTop: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 2 }}>
              Closed Won Deals &amp; ARR:CAC Ratio
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-neutral)' }}>
              Bar = Total Closed Won deals | Line = ARR ÷ All-in S&amp;M Spend
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ChartExportButton
              elementId="chart-arr-cac"
              title="Closed Won Deals & ARR:CAC Ratio"
              onAddToast={addToast}
            />
            <ToggleGroup<View>
              options={[
                { label: 'Monthly',   value: 'monthly'   },
                { label: 'Quarterly', value: 'quarterly' },
                { label: 'Yearly',    value: 'yearly'    },
              ]}
              value={arrCacView}
              onChange={handleArrCacViewChange}
            />

            <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

            {arrCacView === 'quarterly' ? (() => {
              const quarters = monthsToQuarterKeys(months);
              const fromQ = arrCacFrom ? monthToQuarterKey(arrCacFrom) : '';
              const toQ   = arrCacTo   ? monthToQuarterKey(arrCacTo)   : '';
              return (
                <>
                  <Select value={fromQ} onChange={(q) => setArrCacFrom(quarterKeyToFrom(q))}>
                    {quarters.filter((q) => !toQ || q <= toQ).map((q) => (
                      <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                    ))}
                  </Select>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral)' }}>to</span>
                  <Select value={toQ} onChange={(q) => setArrCacTo(quarterKeyToTo(q))}>
                    {quarters.filter((q) => !fromQ || q >= fromQ).map((q) => (
                      <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                    ))}
                  </Select>
                </>
              );
            })() : arrCacView === 'yearly' ? (() => {
              const years  = monthsToYears(months);
              const fromY  = arrCacFrom ? arrCacFrom.slice(0, 4) : '';
              const toY    = arrCacTo   ? arrCacTo.slice(0, 4)   : '';
              return (
                <>
                  <Select value={fromY} onChange={(y) => setArrCacFrom(`${y}-01`)}>
                    {years.filter((y) => !toY || y <= toY).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </Select>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral)' }}>to</span>
                  <Select value={toY} onChange={(y) => setArrCacTo(`${y}-12`)}>
                    {years.filter((y) => !fromY || y >= fromY).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </Select>
                </>
              );
            })() : (
              <>
                <Select value={arrCacFrom} onChange={(m) => setArrCacFrom(m)}>
                  {months.filter((m) => !arrCacTo || m <= arrCacTo).map((m) => (
                    <option key={m} value={m}>{formatMonthShort(m)}</option>
                  ))}
                </Select>
                <span style={{ fontSize: 12, color: 'var(--color-neutral)' }}>to</span>
                <Select value={arrCacTo} onChange={(m) => setArrCacTo(m)}>
                  {months.filter((m) => !arrCacFrom || m >= arrCacFrom).map((m) => (
                    <option key={m} value={m}>{formatMonthShort(m)}</option>
                  ))}
                </Select>
              </>
            )}
          </div>
        </div>

        {loadingArrCac ? (
          <div className="animate-pulse" style={{ height: 400, borderRadius: 8, background: '#f1f5f9' }} />
        ) : arrCacData.length === 0 ? (
          <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
            No data for selected period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={arrCacData} margin={{ top: 20, right: 60, bottom: 60, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 12 }}
                angle={-35}
                textAnchor="end"
                height={70}
              />
              <YAxis
                yAxisId="left"
                orientation="left"
                tickFormatter={(v) => v.toLocaleString()}
                label={{ value: 'Closed Won (count)', angle: -90, position: 'insideLeft', offset: -10, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v: number) => `${v.toFixed(2)}x`}
                label={{ value: 'ARR : CAC ratio', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'Closed Won') return [value.toLocaleString(), 'Closed Won Deals'];
                  if (name === 'ARR:CAC')    return [`${Number(value).toFixed(2)}x`, 'ARR Sub Only : CAC'];
                  return [value, name];
                }}
                labelFormatter={(label) => `Period: ${label}`}
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const row = payload[0]?.payload as ArrCacRow | undefined;
                  return (
                    <div style={{
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: 12,
                      color: 'var(--color-primary)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Period: {label}</div>
                      {payload.map((entry) => (
                        <div key={entry.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
                          <span style={{ color: entry.color as string }}>{entry.name === 'ARR:CAC' ? 'ARR Sub Only : CAC' : 'Closed Won Deals'}</span>
                          <span style={{ fontWeight: 600 }}>
                            {entry.name === 'ARR:CAC'
                              ? `${Number(entry.value).toFixed(2)}x`
                              : Number(entry.value).toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {row && (
                        <>
                          <div style={{ marginTop: 6, borderTop: '1px solid #f1f5f9', paddingTop: 6, color: 'var(--color-neutral)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
                              <span>ARR</span>
                              <span>{formatCurrency(row.arr * 100)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                              <span>All-in Spend</span>
                              <span>{formatCurrency(row.all_in_spend * 100)}</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                }}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar
                yAxisId="left"
                dataKey="won"
                name="Closed Won"
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
                maxBarSize={60}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="arr_cac_ratio"
                name="ARR:CAC"
                stroke="#a855f7"
                strokeWidth={2}
                dot={{ fill: '#a855f7', r: 5 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Chart 3: $ / Opp Trend ───────────────────────────────────────── */}
      <div
        id="chart-opp-trend"
        className="chart-card rounded-xl shadow-sm group"
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          padding: 24,
          marginTop: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 2 }}>
              $ / Opp Trend
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-neutral)' }}>
              LHS Bars = Opportunities | RHS Line = $/Opp
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ChartExportButton
              elementId="chart-opp-trend"
              title="$ / Opp Trend"
              onAddToast={addToast}
            />
            <ToggleGroup<View>
              options={[
                { label: 'Monthly',   value: 'monthly'   },
                { label: 'Quarterly', value: 'quarterly' },
                { label: 'Yearly',    value: 'yearly'    },
              ]}
              value={oppTrendView}
              onChange={handleOppTrendViewChange}
            />

            <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

            {oppTrendView === 'quarterly' ? (() => {
              const quarters = monthsToQuarterKeys(months);
              const fromQ = oppTrendFrom ? monthToQuarterKey(oppTrendFrom) : '';
              const toQ   = oppTrendTo   ? monthToQuarterKey(oppTrendTo)   : '';
              return (
                <>
                  <Select value={fromQ} onChange={(q) => setOppTrendFrom(quarterKeyToFrom(q))}>
                    {quarters.filter((q) => !toQ || q <= toQ).map((q) => (
                      <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                    ))}
                  </Select>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral)' }}>to</span>
                  <Select value={toQ} onChange={(q) => setOppTrendTo(quarterKeyToTo(q))}>
                    {quarters.filter((q) => !fromQ || q >= fromQ).map((q) => (
                      <option key={q} value={q}>{quarterKeyToLabel(q)}</option>
                    ))}
                  </Select>
                </>
              );
            })() : oppTrendView === 'yearly' ? (() => {
              const years = monthsToYears(months);
              const fromY = oppTrendFrom ? oppTrendFrom.slice(0, 4) : '';
              const toY   = oppTrendTo   ? oppTrendTo.slice(0, 4)   : '';
              return (
                <>
                  <Select value={fromY} onChange={(y) => setOppTrendFrom(`${y}-01`)}>
                    {years.filter((y) => !toY || y <= toY).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </Select>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral)' }}>to</span>
                  <Select value={toY} onChange={(y) => setOppTrendTo(`${y}-12`)}>
                    {years.filter((y) => !fromY || y >= fromY).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </Select>
                </>
              );
            })() : (
              <>
                <Select value={oppTrendFrom} onChange={(m) => setOppTrendFrom(m)}>
                  {months.filter((m) => !oppTrendTo || m <= oppTrendTo).map((m) => (
                    <option key={m} value={m}>{formatMonthShort(m)}</option>
                  ))}
                </Select>
                <span style={{ fontSize: 12, color: 'var(--color-neutral)' }}>to</span>
                <Select value={oppTrendTo} onChange={(m) => setOppTrendTo(m)}>
                  {months.filter((m) => !oppTrendFrom || m >= oppTrendFrom).map((m) => (
                    <option key={m} value={m}>{formatMonthShort(m)}</option>
                  ))}
                </Select>
              </>
            )}
          </div>
        </div>

        {loadingOppTrend ? (
          <div className="animate-pulse" style={{ height: 400, borderRadius: 8, background: '#f1f5f9' }} />
        ) : oppTrendData.length === 0 ? (
          <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
            No data for selected period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={oppTrendData} margin={{ top: 20, right: 60, bottom: 60, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 12 }}
                angle={-35}
                textAnchor="end"
                height={70}
              />
              <YAxis
                yAxisId="left"
                orientation="left"
                tickFormatter={(v: number) => v.toLocaleString()}
                label={{ value: 'Opportunities (count)', angle: -90, position: 'insideLeft', offset: -10, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v: number) => formatCurrency(v * 100)}
                label={{ value: '$ / Opp', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'Opportunities') return [value.toLocaleString(), 'Opportunities'];
                  if (name === '$/Opp')         return [formatCurrency(value * 100), '$ / Opp'];
                  return [value, name];
                }}
                labelFormatter={(label) => `Period: ${label}`}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar
                yAxisId="left"
                dataKey="opportunities"
                name="Opportunities"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
                maxBarSize={60}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="dollar_per_opp"
                name="$/Opp"
                stroke="#f97316"
                strokeWidth={2}
                dot={{ fill: '#f97316', r: 5 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Toast notifications ──────────────────────────────────────────── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

    </div>
  );
}

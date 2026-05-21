import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEY_MONITORING_SETTINGS } from '@/utils/constants';

const AUTO_REFRESH_VALUES = new Set(['0', '5000', '10000', '30000', '60000', '300000']);
const TIME_RANGE_VALUES = new Set(['today', '7d', '14d', '30d', 'all', 'custom']);
export const DEFAULT_MONITORING_AUTO_REFRESH_MS = '5000';
export const DEFAULT_MONITORING_TIME_RANGE = 'today';
const EMPTY_CUSTOM_TIME_INPUT = '';
export type MonitoringStoreTimeRange = 'today' | '7d' | '14d' | '30d' | 'all' | 'custom';

const normalizeDateTimeLocalInput = (value: unknown, fallback: string): string => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? normalized : fallback;
};

export const normalizeMonitoringAutoRefreshMs = (value: unknown): string => {
  const normalized =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : String(value ?? '').trim();
  return AUTO_REFRESH_VALUES.has(normalized) ? normalized : DEFAULT_MONITORING_AUTO_REFRESH_MS;
};

export const normalizeMonitoringTimeRange = (value: unknown): MonitoringStoreTimeRange => {
  const normalized = String(value ?? '').trim();
  return TIME_RANGE_VALUES.has(normalized)
    ? (normalized as MonitoringStoreTimeRange)
    : DEFAULT_MONITORING_TIME_RANGE;
};

interface MonitoringState {
  autoRefreshMs: string;
  timeRange: MonitoringStoreTimeRange;
  customStartInput: string;
  customEndInput: string;
  setAutoRefreshMs: (value: string) => void;
  setTimeRange: (value: MonitoringStoreTimeRange) => void;
  setCustomTimeRange: (startInput: string, endInput: string) => void;
}

export const useMonitoringStore = create<MonitoringState>()(
  persist(
    (set) => ({
      autoRefreshMs: DEFAULT_MONITORING_AUTO_REFRESH_MS,
      timeRange: DEFAULT_MONITORING_TIME_RANGE,
      customStartInput: EMPTY_CUSTOM_TIME_INPUT,
      customEndInput: EMPTY_CUSTOM_TIME_INPUT,
      setAutoRefreshMs: (value) => {
        set({ autoRefreshMs: normalizeMonitoringAutoRefreshMs(value) });
      },
      setTimeRange: (value) => {
        const timeRange = normalizeMonitoringTimeRange(value);
        set({
          timeRange,
          ...(timeRange === 'custom'
            ? {}
            : {
                customStartInput: EMPTY_CUSTOM_TIME_INPUT,
                customEndInput: EMPTY_CUSTOM_TIME_INPUT,
              }),
        });
      },
      setCustomTimeRange: (startInput, endInput) => {
        set({
          customStartInput: normalizeDateTimeLocalInput(startInput, EMPTY_CUSTOM_TIME_INPUT),
          customEndInput: normalizeDateTimeLocalInput(endInput, EMPTY_CUSTOM_TIME_INPUT),
        });
      },
    }),
    {
      name: STORAGE_KEY_MONITORING_SETTINGS,
      merge: (persistedState, currentState) => {
        const state = persistedState as Partial<MonitoringState>;
        const timeRange = normalizeMonitoringTimeRange(state?.timeRange);
        return {
          ...currentState,
          autoRefreshMs: normalizeMonitoringAutoRefreshMs(state?.autoRefreshMs),
          timeRange,
          customStartInput:
            timeRange === 'custom'
              ? normalizeDateTimeLocalInput(state?.customStartInput, EMPTY_CUSTOM_TIME_INPUT)
              : EMPTY_CUSTOM_TIME_INPUT,
          customEndInput:
            timeRange === 'custom'
              ? normalizeDateTimeLocalInput(state?.customEndInput, EMPTY_CUSTOM_TIME_INPUT)
              : EMPTY_CUSTOM_TIME_INPUT,
        };
      },
    }
  )
);

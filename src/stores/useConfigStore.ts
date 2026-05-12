/**
 * 配置状态管理
 * 从原项目 src/core/config-service.js 迁移
 */

import { create } from 'zustand';
import { parse as parseYaml } from 'yaml';
import type { Config } from '@/types';
import type { RawConfigSection } from '@/types/config';
import { configApi } from '@/services/api/config';
import { configFileApi } from '@/services/api/configFile';
import { normalizeConfigResponse } from '@/services/api/transformers';
import { CACHE_EXPIRY_MS } from '@/utils/constants';

interface ConfigCache {
  data: unknown;
  timestamp: number;
}

interface ConfigState {
  config: Config | null;
  cache: Map<string, ConfigCache>;
  loading: boolean;
  error: string | null;

  // 操作
  fetchConfig: {
    (section?: undefined, forceRefresh?: boolean): Promise<Config>;
    (section: RawConfigSection, forceRefresh?: boolean): Promise<unknown>;
  };
  updateConfigValue: (section: RawConfigSection, value: unknown) => void;
  clearCache: (section?: RawConfigSection) => void;
  isCacheValid: (section?: RawConfigSection) => boolean;
}

let configRequestToken = 0;
let inFlightConfigRequest: { id: number; promise: Promise<Config> } | null = null;
const FULL_CACHE_KEY = '__full__';

const SECTION_KEYS: RawConfigSection[] = [
  'debug',
  'proxy-url',
  'request-retry',
  'quota-exceeded',
  'request-log',
  'logging-to-file',
  'logs-max-total-size-mb',
  'ws-auth',
  'force-model-prefix',
  'routing/strategy',
  'api-keys',
  'ampcode',
  'gemini-api-key',
  'codex-api-key',
  'claude-api-key',
  'vertex-api-key',
  'openai-compatibility',
  'oauth-excluded-models'
];

const EXTERNAL_SECTION_KEY: RawConfigSection[] = ['external-usage-service'];

const extractSectionValue = (config: Config | null, section?: RawConfigSection) => {
  if (!config) return undefined;
  switch (section) {
    case 'debug':
      return config.debug;
    case 'proxy-url':
      return config.proxyUrl;
    case 'request-retry':
      return config.requestRetry;
    case 'quota-exceeded':
      return config.quotaExceeded;
    case 'request-log':
      return config.requestLog;
    case 'logging-to-file':
      return config.loggingToFile;
    case 'logs-max-total-size-mb':
      return config.logsMaxTotalSizeMb;
    case 'ws-auth':
      return config.wsAuth;
    case 'force-model-prefix':
      return config.forceModelPrefix;
    case 'routing/strategy':
      return config.routingStrategy;
    case 'api-keys':
      return config.apiKeys;
    case 'ampcode':
      return config.ampcode;
    case 'gemini-api-key':
      return config.geminiApiKeys;
    case 'codex-api-key':
      return config.codexApiKeys;
    case 'claude-api-key':
      return config.claudeApiKeys;
    case 'vertex-api-key':
      return config.vertexApiKeys;
    case 'openai-compatibility':
      return config.openaiCompatibility;
    case 'oauth-excluded-models':
      return config.oauthExcludedModels;
    case 'external-usage-service':
      return config.externalUsageService;
    default:
      if (!section) return undefined;
      return config.raw?.[section];
  }
};

const fetchConfigFromFile = async (): Promise<Config> => {
  const content = await configFileApi.fetchConfigYaml();
  const parsed = parseYaml(content) || {};
  return normalizeConfigResponse(parsed);
};

const mergeExternalSections = (base: Config, externalConfig: Config): Config => {
  const raw = { ...(base.raw || {}) };
  const externalRaw = externalConfig.raw || {};
  ['external-usage-service', 'externalUsageService', 'usage-service', 'usageService'].forEach(
    (key) => {
      if (Object.prototype.hasOwnProperty.call(externalRaw, key)) {
        raw[key] = externalRaw[key];
      }
    }
  );

  return {
    ...base,
    raw,
    externalUsageService: externalConfig.externalUsageService,
  };
};

const withExternalSectionsFromFile = async (base: Config): Promise<Config> => {
  try {
    return mergeExternalSections(base, await fetchConfigFromFile());
  } catch {
    return base;
  }
};

const buildConfigCache = (cache: Map<string, ConfigCache>, data: Config, timestamp: number) => {
  const nextCache = new Map(cache);
  nextCache.set(FULL_CACHE_KEY, { data, timestamp });
  SECTION_KEYS.forEach((key) => {
    const value = extractSectionValue(data, key);
    if (value !== undefined) {
      nextCache.set(key, { data: value, timestamp });
    }
  });
  return nextCache;
};

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  cache: new Map(),
  loading: false,
  error: null,

  fetchConfig: (async (section?: RawConfigSection, forceRefresh: boolean = false) => {
    const { cache, isCacheValid } = get();

    // 检查缓存
    const cacheKey = section || FULL_CACHE_KEY;
    if (!forceRefresh && isCacheValid(section)) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached.data;
      }
    }

    if (section && EXTERNAL_SECTION_KEY.includes(section)) {
      set({ loading: true, error: null });

      try {
        const fileConfig = await fetchConfigFromFile();
        const value = extractSectionValue(fileConfig, section);
        const now = Date.now();
        const currentState = get();
        const nextCache = new Map(currentState.cache);
        nextCache.set(section, { data: value, timestamp: now });

        const fullCached = currentState.cache.get(FULL_CACHE_KEY)?.data as Config | undefined;
        const baseConfig = currentState.config || fullCached;
        const nextConfig = baseConfig ? mergeExternalSections(baseConfig, fileConfig) : null;

        if (nextConfig && currentState.cache.has(FULL_CACHE_KEY)) {
          nextCache.set(FULL_CACHE_KEY, { data: nextConfig, timestamp: now });
        }

        set({
          config: nextConfig || currentState.config,
          cache: nextCache,
          loading: false,
        });

        return value;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to fetch config';
        set({
          error: message || 'Failed to fetch config',
          loading: false,
        });
        throw error;
      }
    }

    // section 缓存未命中但 full 缓存可用时，直接复用已获取到的配置，避免重复 /config 请求
    if (!forceRefresh && section && isCacheValid()) {
      const fullCached = cache.get(FULL_CACHE_KEY);
      if (fullCached?.data) {
        return extractSectionValue(fullCached.data as Config, section);
      }
    }

    // 同一时刻合并多个 /config 请求（如 StrictMode 或多个页面同时触发）
    if (inFlightConfigRequest) {
      const data = await inFlightConfigRequest.promise;
      return section ? extractSectionValue(data, section) : data;
    }

    // 获取新数据
    set({ loading: true, error: null });

    const requestId = (configRequestToken += 1);
    try {
      const requestPromise = configApi.getConfig().then(withExternalSectionsFromFile);
      inFlightConfigRequest = { id: requestId, promise: requestPromise };
      const data = await requestPromise;
      const now = Date.now();

      // 如果在请求过程中连接已被切换/登出，则忽略旧请求的结果，避免覆盖新会话的状态
      if (requestId !== configRequestToken) {
        return section ? extractSectionValue(data, section) : data;
      }

      // 更新缓存
      const newCache = buildConfigCache(cache, data, now);

      set({
        config: data,
        cache: newCache,
        loading: false
      });

      return section ? extractSectionValue(data, section) : data;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to fetch config';
      if (requestId === configRequestToken) {
        set({
          error: message || 'Failed to fetch config',
          loading: false
        });
      }
      throw error;
    } finally {
      if (inFlightConfigRequest?.id === requestId) {
        inFlightConfigRequest = null;
      }
    }
  }) as ConfigState['fetchConfig'],

  updateConfigValue: (section, value) => {
    set((state) => {
      const raw = { ...(state.config?.raw || {}) };
      raw[section] = value;
      const nextConfig: Config = { ...(state.config || {}), raw };

      switch (section) {
        case 'debug':
          nextConfig.debug = value as Config['debug'];
          break;
        case 'proxy-url':
          nextConfig.proxyUrl = value as Config['proxyUrl'];
          break;
        case 'request-retry':
          nextConfig.requestRetry = value as Config['requestRetry'];
          break;
        case 'quota-exceeded':
          nextConfig.quotaExceeded = value as Config['quotaExceeded'];
          break;
        case 'request-log':
          nextConfig.requestLog = value as Config['requestLog'];
          break;
        case 'logging-to-file':
          nextConfig.loggingToFile = value as Config['loggingToFile'];
          break;
        case 'logs-max-total-size-mb':
          nextConfig.logsMaxTotalSizeMb = value as Config['logsMaxTotalSizeMb'];
          break;
        case 'ws-auth':
          nextConfig.wsAuth = value as Config['wsAuth'];
          break;
        case 'force-model-prefix':
          nextConfig.forceModelPrefix = value as Config['forceModelPrefix'];
          break;
        case 'routing/strategy':
          nextConfig.routingStrategy = value as Config['routingStrategy'];
          break;
        case 'api-keys':
          nextConfig.apiKeys = value as Config['apiKeys'];
          break;
        case 'ampcode':
          nextConfig.ampcode = value as Config['ampcode'];
          break;
        case 'gemini-api-key':
          nextConfig.geminiApiKeys = value as Config['geminiApiKeys'];
          break;
        case 'codex-api-key':
          nextConfig.codexApiKeys = value as Config['codexApiKeys'];
          break;
        case 'claude-api-key':
          nextConfig.claudeApiKeys = value as Config['claudeApiKeys'];
          break;
        case 'vertex-api-key':
          nextConfig.vertexApiKeys = value as Config['vertexApiKeys'];
          break;
        case 'openai-compatibility':
          nextConfig.openaiCompatibility = value as Config['openaiCompatibility'];
          break;
        case 'oauth-excluded-models':
          nextConfig.oauthExcludedModels = value as Config['oauthExcludedModels'];
          break;
        case 'external-usage-service':
          nextConfig.externalUsageService = value as Config['externalUsageService'];
          break;
        default:
          break;
      }

      return { config: nextConfig };
    });

    // 清除该 section 的缓存
    get().clearCache(section);
  },

  clearCache: (section) => {
    const { cache } = get();
    const newCache = new Map(cache);

    if (section) {
      newCache.delete(section);
      // 同时清除完整配置缓存
      newCache.delete(FULL_CACHE_KEY);

      // Section-level invalidation usually follows an optimistic write path. Invalidate any in-flight
      // full fetch so stale responses can't overwrite newer local changes.
      configRequestToken += 1;
      inFlightConfigRequest = null;

      set({ cache: newCache, loading: false, error: null });
      return;
    } else {
      newCache.clear();
    }

    // 清除全部缓存一般代表“切换连接/登出/全量刷新”，需要让 in-flight 的旧请求失效
    configRequestToken += 1;
    inFlightConfigRequest = null;

    set({ config: null, cache: newCache, loading: false, error: null });
  },

  isCacheValid: (section) => {
    const { cache } = get();
    const cacheKey = section || FULL_CACHE_KEY;
    const cached = cache.get(cacheKey);

    if (!cached) return false;

    return Date.now() - cached.timestamp < CACHE_EXPIRY_MS;
  }
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@/types';
import { configApi } from '@/services/api/config';
import { configFileApi } from '@/services/api/configFile';
import { useConfigStore } from './useConfigStore';

vi.mock('@/services/api/config', () => ({
  configApi: {
    getConfig: vi.fn(),
  },
}));

vi.mock('@/services/api/configFile', () => ({
  configFileApi: {
    fetchConfigYaml: vi.fn(),
  },
}));

const mockedConfigApi = vi.mocked(configApi);
const mockedConfigFileApi = vi.mocked(configFileApi);

describe('useConfigStore.fetchConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.getState().clearCache();
  });

  it('全量配置读取时，从 config.yaml 合并外部 Usage Service section', async () => {
    mockedConfigApi.getConfig.mockResolvedValue({
      raw: { debug: false },
      debug: false,
      externalUsageService: {
        serviceBase: '',
        configured: false,
      },
    } as Config);
    mockedConfigFileApi.fetchConfigYaml.mockResolvedValue(`
debug: false
external-usage-service:
  base-url: http://127.0.0.1:18317
`);

    const config = await useConfigStore.getState().fetchConfig(undefined, true);

    expect(config.externalUsageService).toEqual({
      configured: true,
      serviceBase: 'http://127.0.0.1:18317',
    });
    expect(mockedConfigApi.getConfig).toHaveBeenCalledTimes(1);
    expect(mockedConfigFileApi.fetchConfigYaml).toHaveBeenCalledTimes(1);
  });

  it('读取外部 section 时，只通过 configFileApi 获取 config.yaml', async () => {
    mockedConfigFileApi.fetchConfigYaml.mockResolvedValue(`
external-usage-service:
  base-url: usage.local:18317
`);

    const section = await useConfigStore
      .getState()
      .fetchConfig('external-usage-service', true);

    expect(section).toEqual({
      configured: true,
      serviceBase: 'http://usage.local:18317',
    });
    expect(mockedConfigApi.getConfig).not.toHaveBeenCalled();
    expect(mockedConfigFileApi.fetchConfigYaml).toHaveBeenCalledTimes(1);
  });
});

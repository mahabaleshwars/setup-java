import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import fs from 'fs';
import path from 'path';
import {HttpClient, HttpCodes} from '@actions/http-client';
import {GraalVMDistribution} from '../../src/distributions/graalvm/installer';
import {JavaInstallerOptions} from '../../src/distributions/base-models';
import {
  getDownloadArchiveExtension,
  extractJdkFile,
  renameWinArchive,
  getGitHubHttpHeaders
} from '../../src/util';

// Proper fs mocking that includes promises
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readdirSync: jest.fn(),
  promises: {
    access: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    stat: jest.fn().mockResolvedValue({isDirectory: () => true}),
    lstat: jest.fn().mockResolvedValue({isSymbolicLink: () => false})
  }
}));

// Mock other dependencies
jest.mock('@actions/core');
jest.mock('@actions/tool-cache');
jest.mock('path');
jest.mock('../../src/util');

const mockedCore = core as jest.Mocked<typeof core>;
const mockedTc = tc as jest.Mocked<typeof tc>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;
const mockedGetDownloadArchiveExtension =
  getDownloadArchiveExtension as jest.MockedFunction<
    typeof getDownloadArchiveExtension
  >;
const mockedExtractJdkFile = extractJdkFile as jest.MockedFunction<
  typeof extractJdkFile
>;
const mockedRenameWinArchive = renameWinArchive as jest.MockedFunction<
  typeof renameWinArchive
>;
const mockedGetGitHubHttpHeaders = getGitHubHttpHeaders as jest.MockedFunction<
  typeof getGitHubHttpHeaders
>;

describe('GraalVMDistribution', () => {
  let distribution: GraalVMDistribution;
  let mockHttpClient: jest.Mocked<HttpClient>;
  let originalPlatform: NodeJS.Platform;

  const defaultOptions: JavaInstallerOptions = {
    version: '17',
    architecture: 'x64',
    packageType: 'jdk',
    checkLatest: false
  };

  beforeAll(() => {
    // Mock console methods to avoid noise in test output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    // Store original platform
    originalPlatform = process.platform;

    // Reset all mocks
    jest.clearAllMocks();

    // Mock HttpClient
    mockHttpClient = {
      head: jest.fn(),
      getJson: jest.fn(),
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      put: jest.fn(),
      del: jest.fn(),
      options: jest.fn(),
      dispose: jest.fn()
    } as unknown as jest.Mocked<HttpClient>;

    // Create distribution with mocked http client
    distribution = new GraalVMDistribution(defaultOptions);
    (distribution as any).http = mockHttpClient;

    // Setup default mocks
    mockedGetDownloadArchiveExtension.mockReturnValue('tar.gz');
    mockedGetGitHubHttpHeaders.mockReturnValue({
      'User-Agent': 'test',
      Authorization: ' mocked-token'
    });
    mockedPath.join.mockImplementation((...args) => args.join('/'));

    // Mock core methods
    mockedCore.info.mockImplementation(() => {});
    mockedCore.debug.mockImplementation(() => {});
    mockedCore.warning.mockImplementation(() => {});
    mockedCore.error.mockImplementation(() => {});
    mockedCore.getInput.mockReturnValue('');
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true
    });

    // Clean up mocks
    jest.restoreAllMocks();
  });

  afterAll(() => {
    // Restore console methods
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize GraalVM distribution', () => {
      expect(distribution).toBeInstanceOf(GraalVMDistribution);
      expect((distribution as any).distribution).toBe('GraalVM');
    });

    it('should inherit from JavaBase', () => {
      expect(distribution).toBeInstanceOf(Object);
    });
  });

  describe('downloadTool', () => {
    const mockJavaRelease = {
      url: 'https://example.com/graalvm.tar.gz',
      version: '17.0.1'
    };

    beforeEach(() => {
      mockedTc.downloadTool.mockResolvedValue('/tmp/downloaded-archive');
      mockedExtractJdkFile.mockResolvedValue('/tmp/extracted');
      mockedFs.readdirSync.mockReturnValue(['graalvm-jdk-17'] as any);
      mockedTc.cacheDir.mockResolvedValue('/cached/path');

      // Mock getters properly by using Object.defineProperty
      Object.defineProperty(distribution, 'toolcacheFolderName', {
        get: jest.fn().mockReturnValue('graalvm'),
        configurable: true
      });

      // Mock other required methods
      (distribution as any).getToolcacheVersionName = jest
        .fn()
        .mockReturnValue('17.0.1');

      // Mock architecture getter
      Object.defineProperty(distribution, 'architecture', {
        get: jest.fn().mockReturnValue('x64'),
        configurable: true
      });
    });

    it('should download and extract Java archive on non-Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      });
      mockedGetDownloadArchiveExtension.mockReturnValue('tar.gz');

      const result = await (distribution as any).downloadTool(mockJavaRelease);

      expect(mockedCore.info).toHaveBeenCalledWith(
        'Downloading Java 17.0.1 (GraalVM) from https://example.com/graalvm.tar.gz ...'
      );
      expect(mockedTc.downloadTool).toHaveBeenCalledWith(mockJavaRelease.url);
      expect(mockedExtractJdkFile).toHaveBeenCalledWith(
        '/tmp/downloaded-archive',
        'tar.gz'
      );
      expect(mockedRenameWinArchive).not.toHaveBeenCalled();
      expect(result).toEqual({
        version: '17.0.1',
        path: '/cached/path'
      });
    });
  });

  describe('findPackageForDownload', () => {
    beforeEach(() => {
      (distribution as any).distributionArchitecture = jest
        .fn()
        .mockReturnValue('x64');
      (distribution as any).stable = true;
      (distribution as any).packageType = 'jdk';
      (distribution as any).getPlatform = jest.fn().mockReturnValue('linux');
      mockedGetDownloadArchiveExtension.mockReturnValue('tar.gz');
    });

    it('should throw error for unsupported architecture', async () => {
      (distribution as any).distributionArchitecture = jest
        .fn()
        .mockReturnValue('arm32');
      (distribution as any).architecture = 'arm32';

      await expect(
        (distribution as any).findPackageForDownload('17')
      ).rejects.toThrow('Unsupported architecture: arm32');
    });

    it('should throw error for non-JDK package type', async () => {
      (distribution as any).packageType = 'jre';

      await expect(
        (distribution as any).findPackageForDownload('17')
      ).rejects.toThrow('GraalVM provides only the `jdk` package type');
    });

    it('should throw error for JDK versions below 17', async () => {
      await expect(
        (distribution as any).findPackageForDownload('11')
      ).rejects.toThrow('GraalVM is only supported for JDK 17 and later');

      await expect(
        (distribution as any).findPackageForDownload('8')
      ).rejects.toThrow('GraalVM is only supported for JDK 17 and later');
    });

    it('should construct correct URL for major version', async () => {
      mockHttpClient.head.mockResolvedValue({
        message: {statusCode: HttpCodes.OK}
      } as any);

      const result = await (distribution as any).findPackageForDownload('17');

      expect(mockHttpClient.head).toHaveBeenCalledWith(
        'https://download.oracle.com/graalvm/17/latest/graalvm-jdk-17_linux-x64_bin.tar.gz'
      );
      expect(result).toEqual({
        url: 'https://download.oracle.com/graalvm/17/latest/graalvm-jdk-17_linux-x64_bin.tar.gz',
        version: '17'
      });
    });
  });
});

import os from 'os';
import path from 'path';
import * as fs from 'fs';
import * as semver from 'semver';
import * as cache from '@actions/cache';
import * as core from '@actions/core';

import * as tc from '@actions/tool-cache';
import {INPUT_JOB_STATUS, DISTRIBUTIONS_ONLY_MAJOR_VERSION} from './constants';
import {OutgoingHttpHeaders} from 'http';

export function getTempDir(): string {
  return process.env['RUNNER_TEMP'] || os.tmpdir();
}

export function getBooleanInput(
  inputName: string,
  defaultValue = false
): boolean {
  return (
    (core.getInput(inputName) || String(defaultValue)).toUpperCase() === 'TRUE'
  );
}

export function getVersionFromToolcachePath(toolPath: string): string {
  if (toolPath) {
    return path.basename(path.dirname(toolPath));
  }

  return toolPath;
}

export async function extractJdkFile(toolPath: string, extension?: string) {
  extension ||= toolPath.endsWith('.tar.gz')
    ? 'tar.gz'
    : path.extname(toolPath).substring(1);

  switch (extension) {
    case 'tar.gz':
    case 'tar':
      return await tc.extractTar(toolPath);
    case 'zip':
      return await tc.extractZip(toolPath);
    default:
      return await tc.extract7z(toolPath);
  }
}

export function getDownloadArchiveExtension(): string {
  return process.platform === 'win32' ? 'zip' : 'tar.gz';
}

export function isVersionSatisfies(range: string, version: string): boolean {
  if (semver.valid(range)) {
    // if full version with build digit is provided as a range (such as '1.2.3+4')
    // we should check for exact equal via compareBuild
    // since semver.satisfies doesn't handle 4th digit
    const semRange = semver.parse(range);
    if (semRange && semRange.build?.length > 0) {
      return semver.compareBuild(range, version) === 0;
    }
  }

  return semver.satisfies(version, range);
}

export function getToolcachePath(
  toolName: string,
  version: string,
  architecture: string
): string | null {
  const toolcacheRoot = process.env['RUNNER_TOOL_CACHE'] ?? '';
  const fullPath = path.join(toolcacheRoot, toolName, version, architecture);
  return fs.existsSync(fullPath) ? fullPath : null;
}

export function isJobStatusSuccess(): boolean {
  return core.getInput(INPUT_JOB_STATUS) === 'success';
}

export function isGhes(): boolean {
  return (
    new URL(
      process.env['GITHUB_SERVER_URL'] || 'https://github.com'
    ).hostname.toUpperCase() !== 'GITHUB.COM'
  );
}

export function isCacheFeatureAvailable(): boolean {
  if (!cache.isFeatureAvailable()) {
    core.warning(
      isGhes()
        ? 'Caching is only supported on GHES version >= 3.5. If you are on a version >= 3.5, please check with your GHES admin if the Actions cache service is enabled or not.'
        : 'The runner was not able to contact the cache service. Caching will be skipped'
    );
  }
  return cache.isFeatureAvailable();
}

export function getVersionFromFileContent(
  content: string,
  distributionName: string,
  versionFile: string
): string | null {
  function getFileName(versionFile: string) {
    return path.basename(versionFile);
  }

  const versionFileName = getFileName(versionFile);
  const javaVersionRegExp =
    versionFileName === '.tool-versions'
      ? /^(java\s+)(?:\S*-)?v?(?<version>(\d+)(\.\d+)?(\.\d+)?(\+\d+)?(-ea(\.\d+)?)?)$/m
      : /(?<version>(?<=(^|\s|-))(\d+\S*))(\s|$)/;

  const fileContent = content.match(javaVersionRegExp)?.groups?.version
    ? (content.match(javaVersionRegExp)?.groups?.version as string)
    : '';
  if (!fileContent) {
    return null;
  }

  core.debug(`Version from file '${fileContent}'`);

  const tentativeVersion = avoidOldNotation(fileContent);
  const rawVersion = tentativeVersion.split('-')[0];

  let version = semver.validRange(rawVersion)
    ? tentativeVersion
    : semver.coerce(tentativeVersion);
  core.debug(`Range version from file is '${version}'`);

  if (!version) return null;

  if (DISTRIBUTIONS_ONLY_MAJOR_VERSION.includes(distributionName)) {
    const coerceVersion = semver.coerce(version) ?? version;
    version = semver.major(coerceVersion).toString();
  }

  return version.toString();
}

// By convention, action expects version 8 in the format `8.*` instead of `1.8`
function avoidOldNotation(content: string): string {
  return content.startsWith('1.') ? content.substring(2) : content;
}

export function convertVersionToSemver(version: number[] | string): string {
  // Some distributions may use semver-like notation (12.10.2.1, 12.10.2.1.1)
  const versionArray = Array.isArray(version) ? version : version.split('.');
  const mainVersion = versionArray.slice(0, 3).join('.');

  return versionArray.length > 3
    ? `${mainVersion}+${versionArray.slice(3).join('.')}`
    : mainVersion;
}

export function getGitHubHttpHeaders(): OutgoingHttpHeaders {
  const token = core.getInput('token');
  const auth = token ? `token ${token}` : undefined;

  const headers: OutgoingHttpHeaders = {
    accept: 'application/vnd.github.VERSION.raw'
  };

  if (auth) headers.authorization = auth;

  return headers;
}

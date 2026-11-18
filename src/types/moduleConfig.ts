export type SpoofTimingMode = 'reactive' | 'always';
export type PresetProfileId = 'light' | 'balanced' | 'aggressive';

export interface ModuleConfig {
  packageName: string;
  moduleName: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  spoofTiming: SpoofTimingMode;
  hookActivityLockTask: boolean;
  hookActivityManagerState: boolean;
  hookBinderProxies: boolean;
  hookActivityClient: boolean;
  hookSettingsLockToApp: boolean;
  hookDevicePolicyPermitted: boolean;
  hideFocusLoss: boolean;
  hideWebViewVisibility: boolean;
  hideLifecycleLoss: boolean;
  hideMultiWindowAndPip: boolean;
  spoofPinnedInsets: boolean;
  stripFlagSecure: boolean;
  hideAccessibilityAndOverlays: boolean;
  retainAudioFocus: boolean;
  cloakPackagesAndInstaller: boolean;
  sanitizeStackTraces: boolean;
  spoofMotionSensors: boolean;
  bypassVirtualDisplays: boolean;
  unblockClipboard: boolean;
  spoofPackageSignature: boolean;
  spoofSignatureHex: string;
  softFailIntegrityChecks: boolean;
  includeMaterialYouUi: boolean;
  debugLogging: boolean;
  recommendedScopes: string;
}

export interface GeneratedFile {
  id: string;
  path: string;
  label: string;
  language: 'kotlin' | 'xml' | 'gradle' | 'properties' | 'text' | 'markdown' | 'yaml';
  content: string;
}

export const DEFAULT_MODULE_CONFIG: ModuleConfig = {
  packageName: 'us.redcatx.pinspoof',
  moduleName: 'PinSpoof',
  versionName: '1.3.2',
  versionCode: 6,
  minSdk: 24,
  targetSdk: 36,
  spoofTiming: 'reactive',
  hookActivityLockTask: true,
  hookActivityManagerState: true,
  hookBinderProxies: false,
  hookActivityClient: true,
  hookSettingsLockToApp: false,
  hookDevicePolicyPermitted: false,
  hideFocusLoss: true,
  hideWebViewVisibility: true,
  hideLifecycleLoss: true,
  hideMultiWindowAndPip: true,
  spoofPinnedInsets: false,
  stripFlagSecure: false,
  hideAccessibilityAndOverlays: false,
  retainAudioFocus: false,
  cloakPackagesAndInstaller: false,
  sanitizeStackTraces: false,
  spoofMotionSensors: false,
  bypassVirtualDisplays: false,
  unblockClipboard: false,
  spoofPackageSignature: false,
  spoofSignatureHex: '',
  softFailIntegrityChecks: false,
  includeMaterialYouUi: true,
  debugLogging: false,
  recommendedScopes: '',
};

export function applyPresetToConfig(
  current: ModuleConfig,
  preset: PresetProfileId
): ModuleConfig {
  if (preset === 'light') {
    return {
      ...current,
      spoofTiming: 'reactive',
      hookActivityLockTask: true,
      hookActivityManagerState: true,
      hookActivityClient: true,
      hookBinderProxies: false,
      hideFocusLoss: false,
      hideWebViewVisibility: false,
      hideLifecycleLoss: false,
      hideMultiWindowAndPip: false,
      spoofPinnedInsets: false,
      stripFlagSecure: false,
      hideAccessibilityAndOverlays: false,
      retainAudioFocus: false,
      cloakPackagesAndInstaller: false,
      sanitizeStackTraces: false,
      spoofMotionSensors: false,
      bypassVirtualDisplays: false,
      unblockClipboard: false,
      spoofPackageSignature: false,
      softFailIntegrityChecks: false,
      hookSettingsLockToApp: false,
      hookDevicePolicyPermitted: false,
    };
  }
  if (preset === 'balanced') {
    return {
      ...current,
      spoofTiming: 'reactive',
      hookActivityLockTask: true,
      hookActivityManagerState: true,
      hookActivityClient: true,
      hookBinderProxies: false,
      hideFocusLoss: true,
      hideWebViewVisibility: true,
      hideLifecycleLoss: true,
      hideMultiWindowAndPip: true,
      spoofPinnedInsets: false,
      stripFlagSecure: false,
      hideAccessibilityAndOverlays: false,
      retainAudioFocus: false,
      cloakPackagesAndInstaller: false,
      sanitizeStackTraces: false,
      spoofMotionSensors: false,
      bypassVirtualDisplays: false,
      unblockClipboard: false,
      spoofPackageSignature: false,
      softFailIntegrityChecks: false,
      hookSettingsLockToApp: false,
      hookDevicePolicyPermitted: false,
    };
  }
  return {
    ...current,
    spoofTiming: 'reactive',
    hookActivityLockTask: true,
    hookActivityManagerState: true,
    hookActivityClient: true,
    hookBinderProxies: true,
    hideFocusLoss: true,
    hideWebViewVisibility: true,
    hideLifecycleLoss: true,
    hideMultiWindowAndPip: true,
    spoofPinnedInsets: true,
    stripFlagSecure: true,
    hideAccessibilityAndOverlays: true,
    retainAudioFocus: true,
    cloakPackagesAndInstaller: true,
    sanitizeStackTraces: true,
    spoofMotionSensors: true,
    bypassVirtualDisplays: true,
    unblockClipboard: true,
    spoofPackageSignature: true,
    softFailIntegrityChecks: true,
    hookSettingsLockToApp: true,
    hookDevicePolicyPermitted: true,
  };
}

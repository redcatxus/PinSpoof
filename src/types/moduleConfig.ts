export type SpoofTimingMode = 'reactive' | 'always';

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
  hideLifecycleLoss: boolean;
  hideMultiWindowAndPip: boolean;
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
  versionName: '1.1.0',
  versionCode: 2,
  minSdk: 24,
  targetSdk: 36,
  spoofTiming: 'reactive',
  hookActivityLockTask: true,
  hookActivityManagerState: true,
  hookBinderProxies: true,
  hookActivityClient: true,
  hookSettingsLockToApp: false,
  hookDevicePolicyPermitted: false,
  hideFocusLoss: true,
  hideLifecycleLoss: true,
  hideMultiWindowAndPip: true,
  includeMaterialYouUi: true,
  debugLogging: true,
  recommendedScopes: '',
};

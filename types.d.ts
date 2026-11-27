// Shared static type definitions for Pine Launcher (used by `tsc --noEmit` with checkJs).

export type LoaderType = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
export type ContentCategory = 'mod' | 'resourcepack' | 'modpack' | 'datapack' | 'shader';
export type CloudSyncProviderId = 'google-drive' | 'onedrive' | 'dropbox' | 'local-folder';
export type CloudSyncOAuthProviderId = 'google-drive' | 'onedrive' | 'dropbox';

export interface CurseForgeStatus {
  configured: boolean;
  source: 'saved' | 'env' | 'none';
  secureStorageAvailable: boolean;
  keyHint: string | null;
}

export interface CurseForgeHit {
  source: 'curseforge';
  project_id: string;
  curseforge_id: number;
  title: string;
  author: string;
  description: string;
  downloads: number;
  icon_url: string | null;
  project_type: ContentCategory;
  website_url: string | null;
  categories?: string[];
  date_modified?: string | null;
}

export interface CurseForgeSearchResponse {
  hits: CurseForgeHit[];
  total_hits: number;
  configured: boolean;
}

export interface CloudSyncScopes {
  settings: boolean;
  themes: boolean;
  servers: boolean;
  instances: boolean;
  worlds: boolean;
}

export interface CloudSyncAccountInfo {
  email: string | null;
  name: string | null;
  quotaUsed?: number | null;
  quotaTotal?: number | null;
}

export interface CloudSyncProviderState {
  id: CloudSyncProviderId;
  label: string;
  connected: boolean;
  hasClientId: boolean;
  clientIdSource: 'saved' | 'env' | 'none';
  account: CloudSyncAccountInfo | null;
  redirectUri: string | null;
  consoleUrl: string | null;
  supportsClientSecret: boolean;
  folderPath?: string | null;
}

export interface CloudSyncConfig {
  activeProvider: CloudSyncProviderId | null;
  autoSyncOnExit: boolean;
  scopes: CloudSyncScopes;
  localFolderPath: string;
  maxWorldSizeMb: number;
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
  deviceId: string;
  deviceName: string;
}

export interface CloudSyncStatus {
  config: CloudSyncConfig;
  secureStorageAvailable: boolean;
  connectingProvider: CloudSyncOAuthProviderId | null;
  providers: Record<CloudSyncProviderId, CloudSyncProviderState>;
}

export interface CloudSyncItemDescriptor {
  key: string;
  kind: 'settings' | 'themes' | 'servers' | 'instance' | 'world';
  label: string;
  hash: string;
  size: number;
  modifiedAt: string;
}

export interface CloudSyncConflict {
  key: string;
  kind: CloudSyncItemDescriptor['kind'];
  label: string;
  local: CloudSyncItemDescriptor;
  remote: CloudSyncItemDescriptor;
}

export interface CloudSyncPlan {
  toPush: CloudSyncItemDescriptor[];
  toPull: CloudSyncItemDescriptor[];
  conflicts: CloudSyncConflict[];
  unchanged: CloudSyncItemDescriptor[];
  skipped: Array<{ key: string; label: string; reason: string }>;
}

export interface CloudSyncManifest {
  format: 1;
  product: 'Pine Launcher';
  updatedAt: string;
  deviceId: string;
  deviceName: string;
  items: Record<string, CloudSyncItemDescriptor>;
}

export interface InstanceRecord {
  id: string;
  name: string;
  path?: string;
  customRoot?: string;
  gameVersion: string;
  profile?: string;
  loader: LoaderType;
  loaderVersion?: string | null;
  created?: string;
  lastPlayed?: string | null;
  minMemory?: string;
  maxMemory?: string;
  memoryOverride?: boolean;
  jvmArgs?: string;
  hooks?: { preLaunch?: string; postExit?: string; env?: string } | null;
  group?: string;
  favorite?: boolean;
  iconData?: string | null;
  bannerData?: string | null;
  bannerBlurDir?: string;
  modpack?: Record<string, unknown> | null;
}

export interface LauncherSettings {
  theme?: string;
  uiStyle?: string;
  activeCustomThemeId?: string | null;
  customThemes?: Array<Record<string, unknown>>;
  gayMode?: boolean;
  javaPath?: string;
  minMemory?: string;
  maxMemory?: string;
  defaultMemoryVersion?: number;
  launchBehavior?: 'Keep open' | 'Close on launch';
  dlLimit?: number;
  accentColor?: string;
  windowWidth?: number;
  windowHeight?: number;
  jvmArgs?: string;
  reducedMotion?: boolean;
  discordPresence?: boolean;
  discordShowInstance?: boolean;
  discordShowServer?: boolean;
  compactLibrary?: boolean;
}

/**
 * seed-core capability barrel.
 *
 * Purpose: single import surface for the capability subsystem (manifest
 * validation + registry lifecycle) used by seed-lab, seed-cli and the router.
 * Why it exists: consumers should not reach into file paths that may move;
 * the manifest/registry split stays an implementation detail.
 * Responsibilities: re-export the public capability API only; no logic.
 * Invariants: every export here is defined in manifest.ts or registry.ts.
 * Public: re-exports parseCapabilityManifest, discoverCapabilities,
 * resolveCapabilitySet, startCapability, stopCapability, reloadCapabilitySet
 * and their types/errors.
 */

export {
  CAPABILITY_ABI,
  CAPABILITY_PERMISSIONS,
  DEFAULT_CAPABILITY_LIMITS,
  CapabilityManifestError,
  parseCapabilityManifest,
} from "./manifest.ts";
export type {
  CapabilityActivation,
  CapabilityContribution,
  CapabilityEvaluation,
  CapabilityKind,
  CapabilityLimits,
  CapabilityManifest,
  CapabilityPermission,
  CapabilityProvenance,
  CapabilityRuntime,
} from "./manifest.ts";
export {
  CapabilityPermissionError,
  CapabilityReloadError,
  CapabilityStartError,
  discoverCapabilities,
  reloadCapabilitySet,
  resolveCapabilitySet,
  startCapability,
  stopCapability,
} from "./registry.ts";
export type {
  ActivationContext,
  CapabilityDiscovery,
  CapabilityStartOptions,
  DiscoveredCapability,
  ReloadOptions,
  ReloadResult,
  SkippedCapability,
  StartedCapability,
} from "./registry.ts";

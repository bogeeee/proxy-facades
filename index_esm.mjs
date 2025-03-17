// A wrapper file for ESM to avoid the 'dual package hazard'. See https://nodejs.org/api/packages.html#approach-1-use-an-es-module-wrapper

import cjsCommon from "./common.js"
export const RecordedRead = cjsCommon.RecordedRead;
export const RecordedReadOnProxiedObject = cjsCommon.RecordedReadOnProxiedObject;
export const ClassTrackingConfiguration = cjsCommon.ClassTrackingConfiguration;
export const dualUseTracker_callOrigMethodOnTarget = cjsCommon.dualUseTracker_callOrigMethodOnTarget;
export const IteratorReturningProxiedValue = cjsCommon.IteratorReturningProxiedValue;
export const GetIteratorValueProxiedFn = cjsCommon.GetIteratorValueProxiedFn;
export const DualUseTracker = cjsCommon.DualUseTracker;
export const ForWatchedProxyHandler = cjsCommon.ForWatchedProxyHandler

import cjsProxyFacade from "./proxyFacade"
export const ProxyFacade = cjsProxyFacade.ProxyFacade;
export const FacadeProxyHandler = cjsProxyFacade.FacadeProxyHandler;
export const invalidateObject = cjsProxyFacade.invalidateObject;
export const getGlobalOrig = cjsProxyFacade.getGlobalOrig;

import cjsOrigChangeTracking from "./origChangeTracking"
export const deleteProperty = cjsOrigChangeTracking.deleteProperty;
export const objectHasChangeTrackerInstalled = cjsOrigChangeTracking.objectHasChangeTrackerInstalled;
export const installChangeTracker = cjsOrigChangeTracking.installChangeTracker;

import cjsClassTrackers_Array from "./class-trackers/Array";
export const RecordedArrayValuesRead = cjsClassTrackers_Array.RecordedArrayValuesRead

import cjsClassTrackers_Map from "./class-trackers/Map";
export const RecordedMap_has = cjsClassTrackers_Map.RecordedMap_has;
export const RecordedMap_get = cjsClassTrackers_Map.RecordedMap_get;
export const RecordedMapEntriesRead = cjsClassTrackers_Map.RecordedMapEntriesRead;
export const RecordedMapKeysRead = cjsClassTrackers_Map.RecordedMapKeysRead;
export const RecordedMapValuesRead = cjsClassTrackers_Map.RecordedMapValuesRead;

import cjsClassTrackers_Set from "./class-trackers/Set";
export const RecordedSet_has = cjsClassTrackers_Set.RecordedSet_has;
export const RecordedSetValuesRead = cjsClassTrackers_Set.RecordedSetValuesRead;

import cjsWatchedProxyFacade from "./watchedProxyFacade"
export const RecordedValueRead = cjsWatchedProxyFacade.RecordedValueRead;
export const RecordedUnspecificRead = cjsWatchedProxyFacade.RecordedUnspecificRead;
export const RecordedPropertyRead = cjsWatchedProxyFacade.RecordedPropertyRead;
export const RecordedOwnKeysRead = cjsWatchedProxyFacade.RecordedOwnKeysRead;
export const WatchedProxyFacade = cjsWatchedProxyFacade.WatchedProxyFacade;
export const WatchedProxyHandler = cjsWatchedProxyFacade.WatchedProxyHandler;

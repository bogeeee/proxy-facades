// This file has functions / classes that allow to watch writes to objects (or arrays/sets/maps) **without proxies**


import {RecordedReadOnProxiedObject, WatchedProxyHandler} from "./watchedProxyFacade";
import {MapSet} from "./Util";
import {WriteTrackedArray} from "./class-trackers/array";
import {AfterWriteListener, Clazz, ObjKey, runAndCallListenersOnce_after} from "./common";
import {ObjectProxyHandler, writeListenersForObject} from "./globalObjectWriteTracking";
import {WriteTrackedSet} from "./class-trackers/set";
import {WriteTrackedMap} from "./class-trackers/map";


const objectsWithWriteTrackerInstalled = new WeakSet<object>();

/**
 * Register them here
 */
export const writeTrackerClasses: Set<Clazz> = new Set([WriteTrackedSet, WriteTrackedMap]);

/**
 * Maps the original class to the watcher class
 */
let cache_WriteTrackerClassMap: Map<Clazz, Clazz> | undefined;

export function getWriteTrackerClassFor(obj: object) {
    // lazy initialize
    if(cache_WriteTrackerClassMap === undefined) {
        cache_WriteTrackerClassMap = new Map([...writeTrackerClasses].map(wc => [Object.getPrototypeOf(wc) as any, wc]));
    }

    const clazz = obj.constructor as Clazz;
    return cache_WriteTrackerClassMap.get(clazz);
}

export function objectHasWriteTrackerInstalled(obj: object) {
    return objectsWithWriteTrackerInstalled.has(obj);
}

/**
 *
 * @param obj
 */
export function installWriteTracker(obj: object) {
    if(objectHasWriteTrackerInstalled(obj)) {
        return;
    }

    let watcherClass = getWriteTrackerClassFor(obj);
    if(watcherClass !== undefined) {
        Object.setPrototypeOf(obj, watcherClass.prototype);
    }
    else {
        const proxy = new ObjectProxyHandler(obj, Array.isArray(obj)?WriteTrackedArray:undefined).proxy;
        Object.setPrototypeOf(obj, proxy);
    }
    objectsWithWriteTrackerInstalled.add(obj);
}

/**
 * Use this to delete properties on objects that have a write tracker installer. Otherwise they are not deletable and the write tracker cannot track the object's keys modification and inform listeners
 * @param obj
 * @param key
 */
export function deleteProperty<O extends object>(obj: O, key: keyof O) {
    if(!objectHasWriteTrackerInstalled(obj)) {
        return delete obj[key];
    }

    return runAndCallListenersOnce_after(obj, (callListeners) => {
        const doesExist = Object.getOwnPropertyDescriptor(obj, key) !== undefined;

        if (doesExist) {
            //@ts-ignore
            obj[key] = undefined; // Set to undefined first, so property change listeners will get informed
        }

        const result = delete obj[key];
        if (doesExist) {
            callListeners(writeListenersForObject.get(obj)?.afterChangeOwnKeys_listeners);
            callListeners(writeListenersForObject.get(obj)?.afterAnyWrite_listeners);
        }

        return result;
    });
}

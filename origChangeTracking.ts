// This file has functions / classes that allow to watch writes to the original unproxied objects (or arrays/sets/maps)
// unproxied=not part of a proxy facade. Technically this can install Proxys as the prototype, to catch writes.


import {runAndCallListenersOnce_after} from "./common";
import {ObjectProxyHandler, writeListenersForObject} from "./objectChangeTracking";
import {getTrackingConfigFor} from "./class-trackers/index";


const objectsWithChangeTrackerInstalled = new WeakSet<object>();

export function objectHasChangeTrackerInstalled(obj: object) {
    return objectsWithChangeTrackerInstalled.has(obj);
}

/**
 *
 * @param obj
 */
export function installChangeTracker(obj: object) {
    if(objectHasChangeTrackerInstalled(obj)) {
        return;
    }

    function inner() {
        const trackingConfig = getTrackingConfigFor(obj);
        if (trackingConfig) {
            if (trackingConfig.trackSettingObjectProperties) {
                // Achieve this with the ObjectProxyhandler. It will consider getTrackingConfigFor(obj).changeTracker itsself:
                const proxy = new ObjectProxyHandler(obj, trackingConfig).proxy;
                Object.setPrototypeOf(obj, proxy);
                return;
            }

            if (trackingConfig.changeTracker !== undefined) {
                Object.setPrototypeOf(obj, trackingConfig.changeTracker.prototype);
            }
        } else { // Non-special object ?
            const proxy = new ObjectProxyHandler(obj, trackingConfig).proxy;
            Object.setPrototypeOf(obj, proxy);
        }
    }
    inner();

    objectsWithChangeTrackerInstalled.add(obj);
}

/**
 * Use this to delete properties on objects that have a write tracker installed. Otherwise they are not deletable and the write tracker cannot track the object's keys modification and inform listeners
 * @param obj
 * @param key
 */
export function deleteProperty<O extends object>(obj: O, key: keyof O) {
    if(!objectHasChangeTrackerInstalled(obj)) {
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
            callListeners(writeListenersForObject.get(obj)?.afterChangeOwnKeys);
            callListeners(writeListenersForObject.get(obj)?.afterAnyChange);
        }

        return result;
    });
}

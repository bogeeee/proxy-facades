// This file has functions / classes that allow to watch writes to the original unproxied objects (or arrays/sets/maps)
// unproxied=not part of a proxy facade. Technically this can install Proxys as the prototype, to catch writes.


import {ObjectProxyHandler} from "./objectChangeTracking";
import {getTrackingConfigFor} from "./class-trackers/index";
import {changeTrackedOrigObjects, isProxyForAFacade} from "./proxyFacade";
import {throwError} from "./Util";


/**
 *
 * @param obj
 */
export function installChangeTracker(obj: object) {
    !isProxyForAFacade(obj) || throwError("Cannot install change tracker on a proxy. The proxy should already support change tracking.");
    if(changeTrackedOrigObjects.hasObj(obj)) {
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

    changeTrackedOrigObjects._register(obj);
}


